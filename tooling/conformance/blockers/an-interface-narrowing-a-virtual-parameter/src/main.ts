// expect: `through` cannot be compiled because it calls `Narrow#on`
//
// **The expectation is the refusal, and the refusal is not the point.** What
// this fixture is about is the C that `emit-c` writes *anyway*:
//
//     program.c:73: error: passing 'NtsString *' to parameter of incompatible
//     type 'NtsValue'
//
// Verified by hand, on this fixture, with the same flags `blockers-check.mjs`
// uses. `fails-to-compile` would be the right expectation and the harness
// reports the refusal instead of compiling -- so the guard here covers the
// refusal only, and the clang error is checked by a person until that is
// closed. Stated rather than left as a fixture that looks fully guarded.
// A virtual call coerces its arguments to the signature the **checker
// resolved**, and dispatches through a slot whose signature comes from the
// class that **declares** it. Where an interface narrows a parameter relative
// to the implementing class, the two disagree and nothing notices.
//
// `Narrow.on(type: string, ...)` is concrete, so the argument is coerced to
// `managed<str>` and left there. `Emitter#on(type: string | symbol, ...)` is a
// union, so the slot takes `erased`. The emitted call is
//
//     ((NtsObj_Emitter * (*)(NtsObj_Emitter *, NtsValue, double))
//        v0->header.descriptor->methods[N])((NtsObj_Emitter *)v0, v1, v2)
//
// with `v1` an `NtsString *`. clang: `passing 'NtsString *' to parameter of
// incompatible type 'NtsValue'`. The receiver is cast and the arguments are
// not, because a pointer-to-pointer is a cast and a pointer-to-tagged-value is
// a construction.
//
// # Why this is not a refusal, which is the whole problem
//
// `emit-c` exits zero and writes the file. `hir::verify` does not compare a
// call's argument types against its callee's parameters, so `nts hir
// --prepared` prints
//
//     %5 = call.virtual[51] EventEmitter#prependListener(%0, %1, %2)
//
// with `%1 : managed<str>` against a callee declaring `type: erased`, and calls
// it well-formed. The only thing that objects is the C compiler, and only for
// the erased case: a mismatch between two *pointer* types would compile, link
// and be wrong.
//
// # Found by removing an unrelated refusal
//
// `runtime/node/stream/src/legacy.ts:72` is
//
//     if (typeof emitter.prependListener === "function") {
//       emitter.prependListener(event, listener);
//
// and `typeof o.m === "function"` on an optional method refused until
// 2026-09-16, so that function was never lowered and this was never emitted.
// Lowering the test made 7 of 24 addons stop building, with the first three
// reported reasons naming `new Set`, `Uint8Array.of` and `Object.getPrototypeOf`
// -- the next blockers, not the cause. Second time in one day that a latent
// defect was published by clearing the refusal standing in front of it; see
// `docs/records/0339`.
//
// Reproduced on the gated `9960a3dd` binary, which has none of that work.

class Emitter {
  seen = 0;
  on(type: string | symbol, by: number): void {
    void type;
    this.seen += by;
  }
}

class Loud extends Emitter {
  override on(type: string | symbol, by: number): void {
    void type;
    this.seen += by * 2;
  }
}

/** The narrowing. An interface member has no body, so a call through this type
 *  dispatches to the slot `Emitter` declares -- which takes the union. */
interface Narrow {
  on(type: string, by: number): void;
}

function through(target: Narrow, type: string, by: number): void {
  target.on(type, by);
}

export function drive(n: number): number {
  const e: Emitter = (n & 1) === 0 ? new Emitter() : new Loud();
  through(e, "x", n & 7);
  return e.seen;
}
