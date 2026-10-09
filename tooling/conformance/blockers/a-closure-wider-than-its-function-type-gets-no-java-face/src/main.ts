// expect: emit-jvm -> lacks-interface nts.gen.Closure0 nts.rt.NtsTextPairCallback
//
// A closure that soundly implements a written function type by taking a
// *wider* parameter: `(a: string, b: unknown) => void` returned as `Pair`.
// TypeScript accepts it and calls it correctly through the uniform erased
// entry, so nothing refuses and nothing answers wrong -- the defect is in the
// published Java face only. Lowering links a closure under a signature's class
// only when the types are identical, so this `Closure0` extends
// `erased.Callable`, not `Fn3_3__4`, and its own `call(String, NtsValue)`
// matches no callback interface. A Java caller handed the `Pair` that
// `joiner` returns therefore has no typed way to call it.
//
// Control, one difference: `b: string` in place of `b: unknown` (and `b` in
// place of the `typeof` test). Then `Closure0 extends Fn3_3__4 implements
// nts.rt.NtsTextPairCallback`, and this expectation reports FIXED.
//
// The fix the compiler lane agreed (2026-10-09): link a closure under a
// written signature it is *assignable* to, not only one identical to it. It
// then inherits the signature's typed `call`, which reaches its erased entry
// through `face::typed_call` with the strings boxed into what it reads as
// `unknown` -- the path jvm/tests/typed_face.rs pins.
export type Pair = (a: string, b: string) => void;

let last = "";

export function joiner(prefix: string): Pair {
  return (a: string, b: unknown): void => {
    last = prefix + ":" + a + "|" + (typeof b === "string" ? b : "?");
  };
}

export function callFromTypeScript(f: Pair): void {
  f("x", "y");
}

export function lastSeen(): string {
  return last;
}
