// `map` and `reduce` over a fixed array, which is how the same loop is written
// when it is written with methods instead of by hand.
//
// The point of the measurement is that it should cost what the hand-written
// loop costs. Both are compiled as loops with the callback's body inlined --
// no closure allocated, no indirect call per element -- and `map`'s result is
// one allocation of exactly the right length, whose stores need no bounds
// check because the loop is guarded against that very length.
//
// The values are fractional so that every variant works in `double` and the
// comparison is between the loops rather than between representations.
//
// `xs` is built by indexed assignment rather than by `push`, and that is not
// incidental: `arrays_can_grow` is asked of the *whole program*, so one `push`
// anywhere costs every array in it the bounds-check elimination. That
// coarseness is deliberate and documented, and a benchmark that tripped it
// would be measuring the analysis against a C++ reference that pays no such
// price. The reference indexes for the same reason.
//
// It depends on `seed`, so none of it folds away at compile time.
export function work(seed: number): number {
  const length = 1024;
  const xs = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    xs[i] = seed * 0.5 + i * 0.25;
  }

  let total = 0;
  for (let round = 0; round < 64; round++) {
    // The callback reads `round`, so neither the `map` nor the `reduce` is
    // loop-invariant. Without that the whole pipeline is the same every round
    // and a C++ compiler computes it once and multiplies -- which measures
    // loop-invariant code motion rather than the loop, and reads as a 7x loss
    // that is nothing of the kind.
    const scaled = xs.map((v) => v * 3.5 + round);
    total = total + scaled.reduce((acc, v) => acc + v * 0.5, 0);
  }
  return total;
}
