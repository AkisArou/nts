// expect: emit-c --napi -> lacks-c &nts_fnval_NtsObj_Closure0
//
// FIXED. This is a regression guard, not an open blocker.
//
// **And it was reporting `reproduces` after the fix landed**, which is the sixth
// fixture of mine to do that and the second by this exact mechanism. It expected
// `emits-c 0u, 0u, 0, 0, "Closure0"` -- the null method table -- and that string
// is *still emitted*. What changed is that nothing reaches it: the closure value
// is defined once and referenced nowhere, and `nts_install` is declared and
// never called. The lowering excises the statement that hands a refused closure
// to a native binding, so the descriptor that remains is dead data.
//
// A null `methods` pointer on an unreferenced static is harmless. A null
// `methods` pointer the host can call through is a crash on the first
// invocation. The expectation could not tell those apart, because it named the
// pointer and not the reachability.
//
// So the guard is `lacks-c &nts_fnval_NtsObj_Closure0` -- **the closure's
// address is never taken**. That is the property that matters: a descriptor with
// a null `methods` slot is harmless while nothing can reach it, and a crash the
// moment something does.
//
// `lacks-c nts_install(` was the first attempt and was wrong: the *declaration*
// `void nts_install(NtsHeader *);` contains that text, so the guard failed
// against a correct program. Two wrong expectations for one fixture in one hour,
// both of the same kind -- a string that does not mean what the property means.
//
// Verified against the real module rather than only here. On the gated build
// `timers` has exactly two closures with a null slot, `Closure54` and
// `Closure55`, and **neither is referenced by address**; the two addresses the
// program does take are `Closure20`'s, which has a real vtable. The reachable
// hand-over is gone in both places.
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
