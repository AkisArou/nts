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
 * THIS FILE DOES NOT COMPILE, AND THE SLOT IS THE SECOND PROBLEM. The compiler
 * emits the prototype for a `declare function` taking a callback as a
 * *program-specific* closure struct:
 *
 *     program.c:1864  void nts_node_enqueue_microtask(NtsObj_Closure20 *);
 *     this file       void nts_node_enqueue_microtask(NtsHeader *callback)
 *     error: conflicting types for 'nts_node_enqueue_microtask'
 *
 * The number is per program -- `timers` gets 20, `diagnostics_channel` gets 18 --
 * so a `.c` compiled against every module cannot spell it, and no other spelling
 * is compatible. `blockers/callback-binding` has the reduction. It went unseen
 * because `timers` had not been built since the rename: the counted lane's
 * hardcoded list of seven modules did not include it, and running the lane over
 * all twenty-two is what surfaced it.
 *
 * The slot below *was* the problem after that one, and is fixed. The middle
 * argument is a slot index into the callback descriptor's method table, and the
 * runtime calls straight through it:
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
 * table carries no count to scan, which was checked rather than assumed --
 * `NtsDescriptor` carries a `methods` pointer and no length. Only `program.c`
 * knows it, and it publishes it now as `nts_closure_call_slot`, declared extern
 * in nts_runtime.h and emitted unconditionally so a program with no closures
 * still links. The call below names the symbol.
 *
 * So of the three things wrong with this file, two are fixed: the binding
 * collision that started it, and the slot. What remains is the parameter type,
 * which is the one that stops it compiling. */
void nts_node_enqueue_microtask(NtsHeader *callback) {
    nts_enqueue_microtask(nts_callback_task(callback, nts_closure_call_slot, false));
}
