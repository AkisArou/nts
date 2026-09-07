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
 * posted rather than re-armed wants `false`. A microtask runs once.
 *
 * DO NOT RUN THE THREE MODULES ON THIS YET. The middle argument is a slot index
 * into the callback descriptor's method table, and the runtime calls straight
 * through it:
 *
 *     ((void (*)(NtsHeader *))callback->descriptor->methods[entry->slot])(callback)
 *
 * The `0` below is wrong everywhere it matters. The compiler assigns the
 * closure's call slot *after* every named method in the program, so 0 is
 * correct only for a program declaring no methods at all -- and `async_hooks`,
 * `timers` and `events` all declare plenty, which means `methods[0]` is a null
 * entry and the call goes through a null pointer. These three modules would
 * typecheck, compile, link, and crash on their first microtask, which is a
 * worse outcome than the clang error it replaced because it looks like success
 * until it runs.
 *
 * Neither this file nor the runtime can know the number: a descriptor's method
 * table carries no count to scan. Only `program.c` knows it, so the compiler
 * lane is publishing it as `nts_closure_call_slot`, declared extern in
 * nts_runtime.h and emitted unconditionally. When that lands, the `0` becomes
 * `nts_closure_call_slot` and this warning goes with it. Until then the rename
 * above is the part that is finished; this call is staged, not working. */
void nts_node_enqueue_microtask(NtsHeader *callback) {
    /* TODO(compiler lane): nts_closure_call_slot, not 0. See above. */
    nts_enqueue_microtask(nts_callback_task(callback, 0, false));
}
