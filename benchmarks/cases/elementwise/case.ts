// An elementwise map over an array: the shape a vectorizer exists for.
//
// Every iteration is independent, so there is no ordering to preserve and a
// compiler is free to do four at a time. That is what separates this from
// `accumulate`, whose `+` chain is ordered and which no compiler may
// reassociate without being told it can -- C++ has that ceiling too, so a
// reduction measures nothing about us.
//
// What it measures is whether the loop *counter* is an integer. `xs.length` is
// a `uint32_t`, so a counter bounded by it is not provably an `int32`, and one
// left as a `double` makes every index an `fptoui` of a floating-point
// induction variable -- which LLVM's scalar evolution cannot model, so the
// vectorizer never sees an affine index and emits nothing packed.
//
// A multiply and nothing else, deliberately. `xs[i] * k + 1` is a *fused*
// multiply-add once clang is allowed to contract it, and node is not -- so that
// shape measures floating-point contraction rather than vectorization, and the
// runner caught it: 4.0000004000000402 against node's 4.00000040000004.
//
// It depends on `seed`, so none of it folds away at compile time.
export function scale(xs: number[], seed: number): number {
  const k = seed;
  for (let round = 0; round < 512; round++) {
    for (let i = 0; i < xs.length; i++) {
      xs[i] = xs[i] * k;
    }
  }
  return xs[0] + xs[xs.length - 1];
}
