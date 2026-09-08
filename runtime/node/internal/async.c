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
