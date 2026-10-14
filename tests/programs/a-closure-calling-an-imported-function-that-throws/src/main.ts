// A closure called inside a `try`, calling a function imported from another
// module that throws.
//
// `attempt` calls `run` inside a `try`, so the closure arrives at its raising
// entry, whose body is the closure lowered to carry a `throw` back. Lowering that
// body asks whether each call in it can raise, and asked it of the callee's own
// symbol: for an import that is the local alias, whose only declaration is the
// import specifier, so `thrower(n)` read as a call that cannot raise. No raising
// copy of `thrower` was offered, while the body itself resolved the call to
// `thrower` through the checker and refused to call it uncarried -- so the entry
// was built to abort by name, and every case calling it with 2 or more ended with
// "refused at run time: calling `Closure0#call` from inside a `try`".
//
// The census now reads the declaration an import denotes, as the rest of lowering
// does. What each export pins:
//
//   imported   the imported `thrower`, through a closure, caught as a TypeError
//   local      the same function declared here -- the control, which agreed
//   viaHeld    an imported `const` holding an arrow, caught as a RangeError: a
//              value-held callee, which agreed before and must still -- the alias
//              now resolves to the `const`, and the `const` is still a value
//
// Transcribed from node (v24): 1 below the threshold (returned), 2 when caught as
// the error each arm expects; each export adds `n`.
import { held, thrower } from "./thrower.ts";

function localThrower(x: number): number {
  if (x > 1) throw new TypeError("big");
  return x;
}

function attempt(run: () => number): number {
  try {
    run();
    return 1;
  } catch (error) {
    if (error instanceof TypeError) return 2;
    if (error instanceof RangeError) return 2;
    return 3;
  }
}

export function imported(n: number): number {
  return attempt(() => thrower(n)) + n;
}

export function local(n: number): number {
  return attempt(() => localThrower(n)) + n;
}

export function viaHeld(n: number): number {
  return attempt(() => held(n)) + n;
}
