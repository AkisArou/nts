#include "nts_test_host.h"

#include <stdio.h>
#include <stdlib.h>

/* Tasks posted for "after the current task", in order. */
#define NTS_TEST_CAPACITY 4096u

typedef struct {
    NtsTask task;
    double due;         /* virtual milliseconds; 0 for an immediate */
    double interval;    /* repeating period, or 0 */
    NtsTimerId id;      /* 0 for an immediate */
    bool live;
} NtsTestSlot;

static NtsTestSlot nts_test_slots[NTS_TEST_CAPACITY];
static uint32_t nts_test_len;
static double nts_test_clock;
static NtsTimerId nts_test_next_id;
static uint32_t nts_test_dropped;

static void nts_test_push(NtsTestSlot slot) {
    if (nts_test_len == NTS_TEST_CAPACITY) {
        fprintf(stderr, "nts test host: too many pending tasks\n");
        abort();
    }
    nts_test_slots[nts_test_len++] = slot;
}

static void nts_test_post(void *state, NtsTask task) {
    (void)state;
    NtsTestSlot slot = {task, 0.0, 0.0, 0, true};
    nts_test_push(slot);
}

static NtsTimerId nts_test_post_delayed(void *state, NtsTask task,
                                        double delay_ms, bool repeating) {
    (void)state;
    /* Already whole, non-negative and bounded: `nts_delay` is the one place
     * that decides, so a host cannot decide differently. */
    double delay = delay_ms;
    NtsTimerId id = ++nts_test_next_id;
    NtsTestSlot slot = {task, nts_test_clock + delay,
                        repeating ? delay : 0.0, id, true};
    nts_test_push(slot);
    return id;
}

static void nts_test_cancel(void *state, NtsTimerId id) {
    (void)state;
    for (uint32_t i = 0; i < nts_test_len; i++) {
        if (nts_test_slots[i].live && nts_test_slots[i].id == id) {
            /* Cancelling gives the reference back, which is the other half of
             * "eventually run or dropped". */
            if (nts_test_slots[i].task.drop) {
                nts_test_slots[i].task.drop(nts_test_slots[i].task.state);
            }
            nts_test_slots[i].live = false;
            nts_test_dropped++;
            return;
        }
    }
}

/* There is one thread, so this is the same queue. A host with real threads
 * would signal its loop here; the point of the operation is that callers do
 * not have to know which kind they have. */
static void nts_test_post_any(void *state, NtsTask task) {
    nts_test_post(state, task);
}

static bool nts_test_is_owner(void *state) {
    (void)state;
    return true;
}

void nts_test_host_install(void) {
    for (uint32_t i = 0; i < nts_test_len; i++) {
        if (nts_test_slots[i].live && nts_test_slots[i].task.drop) {
            nts_test_slots[i].task.drop(nts_test_slots[i].task.state);
        }
    }
    nts_test_len = 0;
    nts_test_clock = 0.0;
    nts_test_next_id = 0;
    nts_test_dropped = 0;

    NtsHost host;
    host.post_task = nts_test_post;
    host.post_delayed = nts_test_post_delayed;
    host.cancel_delayed = nts_test_cancel;
    host.post_from_any_thread = nts_test_post_any;
    host.is_owner_thread = nts_test_is_owner;
    host.enqueue_microtask = 0; /* we are not Blink; the runtime checkpoints */
    host.state = 0;
    nts_host_install(&host);
}

double nts_test_host_now(void) { return nts_test_clock; }

uint32_t nts_test_host_dropped(void) { return nts_test_dropped; }

/* The next slot to run: an immediate if there is one, otherwise the earliest
 * timer -- and taking a timer advances the clock to its deadline.
 *
 * Immediates before timers when both are ready is a choice, not a rule: node
 * does not promise the order of `setImmediate` against `setTimeout(f, 0)`, and
 * neither does this. What it does promise is that both eventually run. */
static int nts_test_next(void) {
    int chosen = -1;
    for (uint32_t i = 0; i < nts_test_len; i++) {
        if (nts_test_slots[i].live && nts_test_slots[i].id == 0) {
            return (int)i;
        }
    }
    for (uint32_t i = 0; i < nts_test_len; i++) {
        if (!nts_test_slots[i].live) {
            continue;
        }
        if (chosen < 0 || nts_test_slots[i].due < nts_test_slots[chosen].due) {
            chosen = (int)i;
        }
    }
    if (chosen >= 0 && nts_test_slots[chosen].due > nts_test_clock) {
        nts_test_clock = nts_test_slots[chosen].due;
    }
    return chosen;
}

bool nts_test_host_step(void) {
    /* A checkpoint first, because module evaluation is itself a job and
     * anything it queued is due before any macrotask. Harmless when there is
     * nothing to drain, which is why it can be per-step rather than per-run. */
    nts_enter();
    nts_leave();
    int at = nts_test_next();
    if (at < 0) {
        return false;
    }
    NtsTestSlot slot = nts_test_slots[at];
    if (slot.interval > 0.0) {
        nts_test_slots[at].due = nts_test_clock + slot.interval;
    } else {
        nts_test_slots[at].live = false;
    }
    nts_task_run(slot.task);
    return true;
}

uint32_t nts_test_host_run(uint32_t budget) {
    uint32_t ran = 0;
    while (ran < budget && nts_test_host_step()) {
        ran++;
    }
    if (ran == budget) {
        fprintf(stderr, "nts test host: ran out of budget after %u tasks\n",
                budget);
        abort();
    }
    return ran;
}
