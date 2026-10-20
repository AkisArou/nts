// run: check
// `function skip([,]) {}` called with a generator: the elision is one step of
// the iterator protocol, so node calls `next()` once and the generator body
// runs to its first `yield` (`steps` is 1). nts binds the parameter as an
// erased array and steps nothing, so `steps` stays 0 -- on C, LLVM, Wasm and
// the JVM alike (measured 2026-10-20 on each). A silent wrong answer.
//
// It is what 16 test262 `dstr/*ary-ptrn-elision-exhausted.js` cases hold
// (function, generator, class and object methods). C and LLVM pass them by
// luck, because those cases count only the call and an exhausted iterator
// has no step to observe. Wasm and the JVM refuse them instead: the program
// passes `Generator0` where a `Managed(Array(Erased))` is wanted, and no Wasm
// cast relates the two (NTS5001). Those 16 are Wasm's whole test/language
// parity gap with C. A typed pattern that binds a name over a generator is
// refused by lowering on every backend (NTS1001), so the gap is the untyped
// elision.
//
// The control is `control`: the same elision over an array, where there is no
// step to take, and it agrees.
let steps = 0;

function* counted(seed: number): Generator<number> {
  steps = steps + 1;
  yield seed;
  steps = steps + 1;
  yield seed + 1;
}

function skip([,]: any): void {}

export function work(seed: number): number {
  steps = 0;
  skip(counted(seed));
  return steps;
}

export function control(seed: number): number {
  steps = 0;
  skip([seed, seed + 1]);
  return steps;
}
