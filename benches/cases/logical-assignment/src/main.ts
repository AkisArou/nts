// `a ||= b` in a hot loop, taking both paths.
//
// The operator is a test and a store that happens on one path only. What a C++
// programmer writes for the same thing is `if (!a) a = b;` -- the same test and
// the same conditional store -- so the row asks whether the operator costs more
// than the shape it stands for.
//
// The sequence is a multiply-add step rather than the loop counter, and that is
// load-bearing rather than decoration. A first version wrote `cached ||= i + 1`
// against a counter reset every other iteration, which makes the total an
// affine function of the bound -- so LLVM solved the C++ in closed form and the
// reference measured **1.3 ns** while nts iterated a hundred thousand times.
// A benchmark whose reference the compiler can evaluate is not a ceiling, it is
// a division. The recurrence cannot be closed, so both sides must run the loop.
//
// The low two bits are zero on a quarter of the iterations, so the test goes
// both ways and neither path is the only one measured.
//
// Nothing here allocates, on either side.

export function run(rounds: number): number {
  let total = 0;
  let seed = rounds | 0;
  for (let i = 0; i < rounds; i = i + 1) {
    const step = i | 0;
    seed = (seed * 31 + step) | 0;
    let cached = seed & 3;
    cached ||= step + 1;
    total = (total + cached) | 0;
  }
  return total;
}
