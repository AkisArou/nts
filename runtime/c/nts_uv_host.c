#include "nts_uv_host.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* --- State -----------------------------------------------------------------
 *
 * One host, in file statics rather than behind `NtsHost::state`. The seam
 * passes a state pointer so that a host *can* be per-instance; this one is
 * not, because a process has one loop that owns the heap and two would be two
 * runtimes. The pointer is still threaded through, so making it per-instance
 * later is a change to this file alone.
 */

typedef struct {
    NtsTask *items;
    uint32_t head;
    uint32_t len;
    uint32_t capacity;
} NtsUvQueue;

typedef struct NtsUvTimer {
    uv_timer_t handle;
    NtsTask task;
    /* Which slot holds it, so firing a one-shot can release the slot without
     * searching for it. */
    uint32_t slot;
    bool repeating;
} NtsUvTimer;

/* A slot table rather than a list, so `clearTimeout` is a lookup rather than a
 * scan. The generation is what makes a stale id safe: clearing a timer that
 * already fired is legal and common, and without it the slot would have been
 * reused and a live timer cancelled instead. */
typedef struct {
    NtsUvTimer *timer; /* null when free */
    uint32_t generation;
    uint32_t next_free;
} NtsUvSlot;

#define NTS_UV_NO_SLOT 0xFFFFFFFFu

static uv_loop_t *nts_uv_loop;
static uv_idle_t nts_uv_idle;
static uv_async_t nts_uv_async;
static uv_thread_t nts_uv_owner;
static bool nts_uv_installed;
static uint32_t nts_uv_dropped;

/* Posted by the owner thread. */
static NtsUvQueue nts_uv_tasks;

/* Posted by any other thread, and drained on the owner's. `nts_uv_foreign` is
 * the only state in this file a second thread touches, and the mutex is the
 * only lock: everything else is owner-only by contract, asserted rather than
 * guarded. */
static NtsUvQueue nts_uv_foreign;
static uv_mutex_t nts_uv_foreign_lock;

static NtsUvSlot *nts_uv_slots;
static uint32_t nts_uv_slots_len;
static uint32_t nts_uv_slots_capacity;
static uint32_t nts_uv_free_slot = NTS_UV_NO_SLOT;

static void nts_uv_fail(const char *what) {
    fprintf(stderr, "nts uv host: %s\n", what);
    abort();
}

/* --- A queue of tasks ------------------------------------------------------ */

static void nts_uv_queue_push(NtsUvQueue *queue, NtsTask task) {
    if (queue->len == queue->capacity) {
        uint32_t capacity = queue->capacity ? queue->capacity * 2u : 16u;
        NtsTask *items = calloc(capacity, sizeof(NtsTask));
        if (!items) {
            nts_uv_fail("out of memory growing a task queue");
        }
        /* Unwrap the ring while copying, so the new buffer starts at zero. */
        for (uint32_t i = 0; i < queue->len; i++) {
            items[i] = queue->items[(queue->head + i) % queue->capacity];
        }
        free(queue->items);
        queue->items = items;
        queue->capacity = capacity;
        queue->head = 0;
    }
    queue->items[(queue->head + queue->len) % queue->capacity] = task;
    queue->len++;
}

static bool nts_uv_queue_pop(NtsUvQueue *queue, NtsTask *task) {
    if (queue->len == 0) {
        return false;
    }
    *task = queue->items[queue->head];
    queue->head = (queue->head + 1) % queue->capacity;
    queue->len--;
    return true;
}

/* Give back every task still in the queue, which is the other half of "run or
 * dropped". */
static void nts_uv_queue_drop(NtsUvQueue *queue) {
    NtsTask task;
    while (nts_uv_queue_pop(queue, &task)) {
        if (task.drop) {
            task.drop(task.state);
        }
        nts_uv_dropped++;
    }
    free(queue->items);
    queue->items = 0;
    queue->capacity = 0;
    queue->head = 0;
}

/* --- The timer slot table -------------------------------------------------- */

static uint32_t nts_uv_slot_claim(NtsUvTimer *timer) {
    if (nts_uv_free_slot != NTS_UV_NO_SLOT) {
        uint32_t index = nts_uv_free_slot;
        nts_uv_free_slot = nts_uv_slots[index].next_free;
        nts_uv_slots[index].timer = timer;
        return index;
    }
    if (nts_uv_slots_len == nts_uv_slots_capacity) {
        uint32_t capacity = nts_uv_slots_capacity ? nts_uv_slots_capacity * 2u : 16u;
        NtsUvSlot *slots = realloc(nts_uv_slots, capacity * sizeof(NtsUvSlot));
        if (!slots) {
            nts_uv_fail("out of memory growing the timer table");
        }
        memset(slots + nts_uv_slots_capacity, 0,
               (capacity - nts_uv_slots_capacity) * sizeof(NtsUvSlot));
        nts_uv_slots = slots;
        nts_uv_slots_capacity = capacity;
    }
    uint32_t index = nts_uv_slots_len++;
    nts_uv_slots[index].timer = timer;
    nts_uv_slots[index].generation = 1;
    return index;
}

static void nts_uv_slot_release(uint32_t index) {
    nts_uv_slots[index].timer = 0;
    /* A wrapped generation would make one stale id valid again, out of four
     * billion cancellations of one slot. Skipping zero keeps "generation 0"
     * meaning "never used", which is what a freshly grown slot has. */
    nts_uv_slots[index].generation++;
    if (nts_uv_slots[index].generation == 0) {
        nts_uv_slots[index].generation = 1;
    }
    nts_uv_slots[index].next_free = nts_uv_free_slot;
    nts_uv_free_slot = index;
}

static NtsTimerId nts_uv_slot_id(uint32_t index) {
    /* One-based, so that zero is never a live id.
     *
     * The generation is masked to twenty-one bits so the whole id fits in the
     * fifty-three a `double` holds exactly: `setTimeout` hands its id to a
     * program, where it is a number, and an id that did not survive that round
     * trip would cancel the wrong timer. Two million reuses of one slot before
     * a stale id could alias, against four billion unmasked. */
    NtsTimerId generation = nts_uv_slots[index].generation & 0x1FFFFFu;
    return (generation << 32) | (NtsTimerId)(index + 1);
}

static NtsUvTimer *nts_uv_slot_find(NtsTimerId id) {
    uint32_t index = (uint32_t)(id & 0xFFFFFFFFu);
    uint32_t generation = (uint32_t)(id >> 32) & 0x1FFFFFu;
    if (index == 0 || index > nts_uv_slots_len) {
        return 0;
    }
    index--;
    if ((nts_uv_slots[index].generation & 0x1FFFFFu) != generation) {
        /* Already fired, or already cancelled. `clearTimeout` of a timer that
         * has run is a no-op, not an error. */
        return 0;
    }
    return nts_uv_slots[index].timer;
}

/* --- The five operations --------------------------------------------------- */

static bool nts_uv_is_owner(void *state) {
    (void)state;
    return uv_thread_equal(&nts_uv_owner, &(uv_thread_t){uv_thread_self()});
}

static void nts_uv_require_owner(const char *what) {
    if (!nts_uv_is_owner(0)) {
        fprintf(stderr, "nts uv host: %s from a thread that does not own the loop\n",
                what);
        abort();
    }
}

static void nts_uv_drain_tasks(uv_idle_t *idle) {
    (void)idle;
    /* One pass over what was queued when the drain started, not until the
     * queue is empty: a task that posts a task would otherwise starve the
     * loop, and posting is how a program yields to I/O. */
    uint32_t pending = nts_uv_tasks.len;
    for (uint32_t i = 0; i < pending; i++) {
        NtsTask task;
        if (!nts_uv_queue_pop(&nts_uv_tasks, &task)) {
            break;
        }
        /* `nts_task_run`, never `task.run`: the checkpoint belongs to the
         * runtime, so a host cannot omit one by forgetting. */
        nts_task_run(task);
    }
    if (nts_uv_tasks.len == 0) {
        uv_idle_stop(&nts_uv_idle);
    }
}

static void nts_uv_post_task(void *state, NtsTask task) {
    (void)state;
    nts_uv_require_owner("post_task");
    nts_uv_queue_push(&nts_uv_tasks, task);
    /* Started only while there is something to drain. An idle handle that
     * stays started keeps `uv_run` from ever blocking, which is a busy loop
     * that also never lets the process exit. */
    uv_idle_start(&nts_uv_idle, nts_uv_drain_tasks);
}

static void nts_uv_timer_closed(uv_handle_t *handle) {
    free(handle->data);
}

/* Close the handle and let go of the slot. The task is *not* dropped here:
 * whether it ran or was cancelled is the caller's to say. */
static void nts_uv_timer_retire(NtsUvTimer *timer) {
    nts_uv_slot_release(timer->slot);
    timer->handle.data = timer;
    uv_close((uv_handle_t *)&timer->handle, nts_uv_timer_closed);
}

static void nts_uv_timer_fired(uv_timer_t *handle) {
    NtsUvTimer *timer = (NtsUvTimer *)handle;
    if (timer->repeating) {
        /* The task is run again and again, so it keeps its reference and the
         * handle stays live until it is cancelled. */
        nts_task_run(timer->task);
        return;
    }
    NtsTask task = timer->task;
    nts_uv_timer_retire(timer);
    nts_task_run(task);
}

static NtsTimerId nts_uv_post_delayed(void *state, NtsTask task, double delay_ms,
                                      bool repeating) {
    (void)state;
    nts_uv_require_owner("post_delayed");
    NtsUvTimer *timer = calloc(1, sizeof(NtsUvTimer));
    if (!timer) {
        nts_uv_fail("out of memory allocating a timer");
    }
    if (uv_timer_init(nts_uv_loop, &timer->handle) != 0) {
        nts_uv_fail("could not initialise a timer");
    }
    timer->task = task;
    timer->repeating = repeating;
    timer->slot = nts_uv_slot_claim(timer);

    /* Negative and NaN delays are zero, which is what `setTimeout` specifies
     * and what every platform does. The comparison is written so that NaN
     * takes the zero branch rather than the other way about. */
    double delay = (delay_ms > 0.0) ? delay_ms : 0.0;
    uint64_t ms = (uint64_t)delay;
    if (uv_timer_start(&timer->handle, nts_uv_timer_fired, ms, repeating ? ms : 0) != 0) {
        nts_uv_fail("could not start a timer");
    }
    return nts_uv_slot_id(timer->slot);
}

static void nts_uv_cancel_delayed(void *state, NtsTimerId id) {
    (void)state;
    nts_uv_require_owner("cancel_delayed");
    NtsUvTimer *timer = nts_uv_slot_find(id);
    if (!timer) {
        return;
    }
    uv_timer_stop(&timer->handle);
    NtsTask task = timer->task;
    nts_uv_timer_retire(timer);
    /* Cancelling gives the reference back. */
    if (task.drop) {
        task.drop(task.state);
    }
    nts_uv_dropped++;
}

static void nts_uv_drain_foreign(uv_async_t *async) {
    (void)async;
    /* Move the whole batch out under the lock, then run it without one: a task
     * runs compiled code, which can post again from this thread, and holding
     * the lock across that would deadlock on the first one. */
    NtsUvQueue batch;
    uv_mutex_lock(&nts_uv_foreign_lock);
    batch = nts_uv_foreign;
    memset(&nts_uv_foreign, 0, sizeof(nts_uv_foreign));
    uv_mutex_unlock(&nts_uv_foreign_lock);

    NtsTask task;
    while (nts_uv_queue_pop(&batch, &task)) {
        nts_task_run(task);
    }
    free(batch.items);
}

static void nts_uv_post_from_any_thread(void *state, NtsTask task) {
    (void)state;
    /* The one operation with no owner assertion: being callable from a
     * completion thread is its entire purpose. Everything a foreign thread can
     * reach goes through here, which is what keeps heap mutation on one
     * thread (RFC 17.4). */
    uv_mutex_lock(&nts_uv_foreign_lock);
    nts_uv_queue_push(&nts_uv_foreign, task);
    uv_mutex_unlock(&nts_uv_foreign_lock);
    uv_async_send(&nts_uv_async);
}

/* --- Installation and teardown --------------------------------------------- */

void nts_uv_host_install(uv_loop_t *loop) {
    if (nts_uv_installed) {
        nts_uv_fail("installed twice");
    }
    nts_uv_loop = loop;
    nts_uv_owner = uv_thread_self();
    nts_uv_dropped = 0;

    if (uv_mutex_init(&nts_uv_foreign_lock) != 0) {
        nts_uv_fail("could not create the foreign-post lock");
    }
    if (uv_idle_init(loop, &nts_uv_idle) != 0) {
        nts_uv_fail("could not create the task handle");
    }
    if (uv_async_init(loop, &nts_uv_async, nts_uv_drain_foreign) != 0) {
        nts_uv_fail("could not create the cross-thread handle");
    }
    /* Unreferenced: an async handle is always active, so a referenced one
     * would keep `uv_run` alive forever and a program with nothing left to do
     * would never exit. It still wakes the loop when something is sent. */
    uv_unref((uv_handle_t *)&nts_uv_async);

    static const NtsHost host = {
        nts_uv_post_task,
        nts_uv_post_delayed,
        nts_uv_cancel_delayed,
        nts_uv_post_from_any_thread,
        nts_uv_is_owner,
        /* Null: this host does not own checkpointing, so the runtime's two
         * queues and its drain are the ones that run. Only a Blink renderer
         * supplies one. */
        0,
        0,
    };
    nts_host_install(&host);
    nts_uv_installed = true;
}

int nts_uv_host_run(void) {
    nts_uv_require_owner("run");
    return uv_run(nts_uv_loop, UV_RUN_DEFAULT);
}

/* Every timer this host started and the program never cancelled.
 *
 * Over the slot table rather than `uv_walk`, which was the first version and
 * was wrong: it identified a timer as "a `UV_TIMER` on this loop" and cast it
 * to one of ours. The loop is not necessarily ours -- an embedder passes its
 * own -- so a timer belonging to anything else would have been read as an
 * `NtsUvTimer` and its `slot` used as an index. The slot table is the thing
 * that actually knows, and it costs one pass either way.
 *
 * Found by this suite's watchdog, which is a `uv_timer_t` the host did not
 * start. */
static void nts_uv_close_timers(void) {
    for (uint32_t index = 0; index < nts_uv_slots_len; index++) {
        NtsUvTimer *timer = nts_uv_slots[index].timer;
        if (!timer) {
            continue;
        }
        uv_timer_stop(&timer->handle);
        NtsTask task = timer->task;
        /* Releases the slot, so the next iteration reads a null. */
        nts_uv_timer_retire(timer);
        if (task.drop) {
            task.drop(task.state);
        }
        nts_uv_dropped++;
    }
}

void nts_uv_host_shutdown(void) {
    if (!nts_uv_installed) {
        return;
    }
    nts_uv_require_owner("shutdown");

    uv_idle_stop(&nts_uv_idle);
    uv_close((uv_handle_t *)&nts_uv_idle, 0);
    uv_close((uv_handle_t *)&nts_uv_async, 0);
    nts_uv_close_timers();

    nts_uv_queue_drop(&nts_uv_tasks);
    uv_mutex_lock(&nts_uv_foreign_lock);
    nts_uv_queue_drop(&nts_uv_foreign);
    uv_mutex_unlock(&nts_uv_foreign_lock);

    /* Let the close callbacks run, which is what frees the timers. */
    uv_run(nts_uv_loop, UV_RUN_NOWAIT);
    uv_run(nts_uv_loop, UV_RUN_NOWAIT);

    uv_mutex_destroy(&nts_uv_foreign_lock);
    free(nts_uv_slots);
    nts_uv_slots = 0;
    nts_uv_slots_len = 0;
    nts_uv_slots_capacity = 0;
    nts_uv_free_slot = NTS_UV_NO_SLOT;
    nts_uv_installed = false;
}

uint32_t nts_uv_host_dropped(void) { return nts_uv_dropped; }
