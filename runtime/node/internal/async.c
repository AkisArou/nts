/* The two of `async-context.ts`'s and `async-hooks.ts`'s bindings that can be
 * written, and a plain statement of what the third and the machinery around
 * them do not do.
 *
 * All three were undefined in **thirteen of the twenty addons that build** --
 * `nm -D` on the artifacts, 2026-09-09 -- and a shared object binds lazily, so
 * each one loaded and would have aborted on first call rather than failing at
 * link.
 *
 * `nts_async_context_get` is NOT here and cannot be. It returns
 * `AsyncContextFrame | undefined`, so the emitted prototype is
 *
 *     NtsObj_AsyncContextFrame * nts_async_context_get(void);
 *
 * and the type is named per program, so the one definition every program links
 * against cannot spell it. The `NtsHeader *` escape that solves this for
 * parameters -- the one `nts_timers_install` and `nts_node_enqueue_microtask`
 * use -- is not applied in return position.
 * `tooling/conformance/blockers/binding-returns-program-type` is the
 * reduction, with the parameter and callback forms beside it as controls.
 */
#include <stdlib.h>
#include <uv.h>

#include "nts_node.h"
#include "shared.h"

/* The frame the current continuation carries.
 *
 * **This is a variable, and node's is not.** V8 keeps the frame in
 * continuation-preserved embedder data, so it travels with the continuation
 * itself: code resuming after an `await` sees what was set before the `await`,
 * not what some other task set in between. A static sees the latter.
 *
 * That difference does not bite yet and it is not fixed here, deliberately.
 * `async-context.ts` saves and restores around every scope it enters -- "install
 * `frame` and hand back what it replaced, for restoring later" -- so within one
 * synchronous run this is faithful. Across a suspension it is not, and making it
 * so means capturing this in `nts_node_enqueue_microtask` and restoring it when
 * the task runs.
 *
 * That is left undone because it cannot be tested. `nts_async_context_get` is
 * unwritable, so no compiled program can read this back, so any propagation
 * logic written now would be unexercised by construction. Writing untested
 * continuation machinery is worse than writing none: it would look finished.
 *
 * When the return-position escape lands, `get` returns this and the propagation
 * question becomes answerable -- and has to be answered before
 * `AsyncLocalStorage` means anything across an await. */
/* The same cast the emitter makes at every closure call site: the method table
 * stores untyped pointers and the caller spells the signature. */
static void call_0(NtsHeader *callback) {
    if (callback == NULL) return;
    ((void (*)(NtsHeader *))
         callback->descriptor->methods[nts_closure_call_slot])(callback);
}

static NtsHeader *current_frame = NULL;

void nts_async_context_set(NtsHeader *frame) {
    if (frame == current_frame) return;
    if (frame != NULL) nts_retain(frame);
    if (current_frame != NULL) nts_release(current_frame);
    current_frame = frame;
}

/* Report `resource` as collected, so a `destroy` hook can fire for it.
 *
 * **Nothing is registered and the callback never runs.** The stand-in on the
 * interpreted lane hands the pair to a `FinalizationRegistry`; this runtime has
 * no weak reference and no finalization primitive at all -- `nm` and the
 * runtime header agree, there is no `NtsWeak`, no `nts_weak_*`, and nothing
 * that takes a callback for collection.
 *
 * So a `destroy` hook does not fire for a resource this runtime owns. That is a
 * real divergence from node and it is stated here rather than hidden, because
 * the alternative -- leaving the symbol undefined -- is an abort on first call
 * in thirteen addons, and an abort is not more honest than a documented gap
 * when the gap is written where the reader will be.
 *
 * The retain is deliberate and is the one thing this can do correctly: node's
 * registry holds the callback until collection, so dropping it here would be a
 * second divergence on top of the first, and a caller cannot tell the two
 * apart. Held for the life of the process, which is the longest this can
 * promise and the shortest node would.
 *
 * This needs a runtime primitive rather than a binding, so there is no fixture
 * for it -- there is no program that reproduces it, only an absence. */
void nts_on_collected(NtsValue resource, NtsHeader *on_collected) {
    (void)resource;
    if (on_collected != NULL) nts_retain(on_collected);
}

/* ------------------------------------------- unreferenced immediates */

/* Work in the host's check phase that does not keep the loop alive.
 *
 * `async_hooks` uses this to finish tearing a hook down: the work must run, and
 * it must not be the reason the process is still running. That is two
 * properties and they need two handles, for the reason `timers.c` explains at
 * length: **`uv_backend_timeout` does not consider check handles.** With only a
 * check started, the loop blocks in poll until something else happens, and the
 * callback never runs -- the handle is active, the loop is alive, and it is
 * asleep. A started idle handle *is* in the queue that timeout reads, so one
 * beside the check forces the iteration.
 *
 * Both are unreferenced, which is the difference from `timers.c`: there the
 * check carries the process's liveness and only the pump is unref'd. Here
 * neither may.
 *
 * Both are started only while the queue has something in it. An idle handle
 * left started spins the loop at full CPU, which is the cost of the mechanism
 * and the reason `timers.c` stops its pump too. */
typedef struct Immediate {
    NtsHeader *callback;
    struct Immediate *next;
} Immediate;

static Immediate *immediates_head = NULL;
static Immediate *immediates_tail = NULL;
static uv_check_t immediate_check;
static uv_idle_t immediate_pump;
static bool immediate_handles_ready = false;
static bool immediate_running = false;

static void immediate_pump_noop(uv_idle_t *handle) { (void)handle; }

static void immediate_drain(uv_check_t *handle) {
    (void)handle;
    /* Snapshot: a callback that schedules another immediate must have it run on
     * the next turn, not appended to the list being walked. Draining in place
     * would run it now and could not terminate. */
    Immediate *pending = immediates_head;
    immediates_head = NULL;
    immediates_tail = NULL;

    /* Stopped before the callbacks rather than after: one of them may schedule
     * another, and that has to start the handles again rather than be undone by
     * a stop that runs later. */
    uv_check_stop(&immediate_check);
    uv_idle_stop(&immediate_pump);
    immediate_running = false;

    while (pending != NULL) {
        Immediate *next = pending->next;
        call_0(pending->callback);
        if (pending->callback != NULL) nts_release(pending->callback);
        free(pending);
        pending = next;
    }
}

void nts_schedule_unreferenced_immediate(NtsHeader *callback) {
    if (callback == NULL) return;
    Immediate *entry = calloc(1, sizeof(Immediate));
    if (entry == NULL) return;
    entry->callback = callback;
    nts_retain(callback);

    if (immediates_tail == NULL) {
        immediates_head = entry;
    } else {
        immediates_tail->next = entry;
    }
    immediates_tail = entry;

    if (!immediate_handles_ready) {
        uv_loop_t *loop = uv_default_loop();
        uv_check_init(loop, &immediate_check);
        uv_idle_init(loop, &immediate_pump);
        /* Unreferenced once, here. `uv_unref` on a handle that has never been
         * started still records the state, and neither is referenced again. */
        uv_unref((uv_handle_t *)&immediate_check);
        uv_unref((uv_handle_t *)&immediate_pump);
        immediate_handles_ready = true;
    }
    if (!immediate_running) {
        uv_check_start(&immediate_check, immediate_drain);
        uv_idle_start(&immediate_pump, immediate_pump_noop);
        immediate_running = true;
    }
}
