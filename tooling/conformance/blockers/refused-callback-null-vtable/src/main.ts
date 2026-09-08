// expect: emit-c --napi -> emits-c 0u, 0u, 0, 0, "Closure0"
//
// A **refused** function passed as a callback becomes a closure with a null
// method table, and the program compiles:
//
//     nts_desc_NtsObj_Closure0 = { NTS_KIND_OBJECT, sizeof(NtsObj_Closure0),
//                                  0u, 0u, 0, 0, "Closure0", 0u, 0 };
//                                            ^ methods
//
// Every working closure has a `nts_vtable_NtsObj_ClosureN` pointer there. This
// one has `0`, because the function it closes over was refused and so no body
// was emitted to point at -- but the descriptor, the static instance and the
// call site were all emitted anyway.
//
// **The danger is that it compiles.** A hand-written binding calls a callback as
//
//     callback->descriptor->methods[nts_closure_call_slot]
//
// which is a null dereference the first time the host invokes it. `emit-c`
// reports success, clang accepts the file, the addon loads, and it fails at the
// first timer.
//
// It has a louder sibling in the same program: sometimes the vtable *is*
// emitted, referencing a `ClosureNN__call` that was never declared or defined,
// and clang stops. That variant is the safe one.
//
// Found by bisecting `timers` rather than by guessing -- six hypotheses about
// the shape were wrong first. `timers` reaches it through
// `host.install(processTimers, processImmediate)` where `processTimers` is
// refused at `timeout.ts:286`; replacing the two drains with local arrows makes
// the error disappear, which is what identified the trigger.
//
// **The compiler says so itself, and emits the object anyway.** The refusal is
// not silent -- it is reported by name:
//
//     drain.ts:3:21  NTS1003 `Closure0#call` cannot be compiled because it
//                    calls `onTimers`, which was refused above
//
// and in `timers`, both halves of the pair:
//
//     timeout.ts:488    NTS1003 `Closure55#call` cannot be compiled because it
//                       calls `processTimers`, which was refused above
//     immediate.ts:211  NTS2009 `Closure54#call` cannot be emitted because it
//                       calls `processImmediate`, which this backend refused
//
// So this is not a case of the emitter losing track of something. It has already
// concluded that the closure's body cannot exist, has printed that conclusion,
// and then writes the descriptor, the static instance and the call site as
// though it had not. The two diagnostics even differ -- one from the lowering,
// one from the backend -- and both are followed by the same emission.
//
// The general statement: **a closure whose `call` has been refused should refuse
// at the point it is taken as a value**, not produce an object that cannot be
// called. A descriptor with a null `methods` pointer is never correct and is
// checkable at emission, and here the information needed to refuse was already
// in hand.

import { onTimers } from "./drain.ts";

declare function nts_install(a: (now: number) => void): void;

nts_install(onTimers);

export function touch(): number {
  return 1;
}
