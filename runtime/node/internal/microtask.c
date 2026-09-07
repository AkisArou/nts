#include "nts_node.h"
#include "shared.h"

/* Enqueue a compiled callback as a microtask.
 *
 * The runtime's own `nts_enqueue_microtask` takes an `NtsTask` -- a
 * `{ run, drop, state }` struct -- and this profile's TypeScript declared a
 * binding of the *same name* taking `(callback: () => void)`. The compiler
 * lowered that declaration faithfully and emitted a call passing the callback
 * object's address, which is how `async_hooks`, `diagnostics_channel` and
 * `timers` each came to fail their clang step on
 *
 *     passing 'NtsObj_Closure18 *' to parameter of incompatible type 'NtsTask'
 *
 * for months. Nothing was wrong with the lowering and nothing was wrong with
 * the runtime: a `declare function` had claimed a runtime symbol whose real
 * signature was different, and the collision was invisible until a module got
 * far enough to reach the link.
 *
 * So the binding has its own name now, and this is the adapter. `nts_callback_
 * task` is the runtime's own converter and its comment is emphatic about the
 * one argument worth getting wrong: `repeating` selects the reference
 * discipline, a task run once gives its reference back by running, and anything
 * posted rather than re-armed wants `false`. A microtask runs once. */
void nts_node_enqueue_microtask(NtsHeader *callback) {
    nts_enqueue_microtask(nts_callback_task(callback, 0, false));
}
