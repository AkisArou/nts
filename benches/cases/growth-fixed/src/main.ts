// Half of a pair. Its twin, `growth-grown`, is the same program with the array
// built by `push` instead of by index.
//
// `hir::arrays_can_grow` is a **whole-program** predicate: one `push` anywhere
// puts every array in the program behind a pointer, because an array that grows
// cannot keep its elements inline after its own header without moving -- and
// moving invalidates every reference someone holds. So the two halves of this
// pair differ by one call in *setup* and get different representations in the
// hot loop, which is the thing being priced.
//
// Nothing measured this before. `benches/cases/array-mutations` grows an array
// but is *about* growing one; `array-predicates` and `case-convert` each have a
// stray `push` in setup and are silently on the far side of the cliff without
// saying so. And `examples/growable` states outright that "the `arrays`
// benchmark measured the difference at nothing" -- which `arrays` cannot have
// done, because it contains no `push` and is therefore on one side only.
//
// Setup is 2048 elements against a hot loop of 64 rounds over 2047, so it is
// about one and a half per cent of the work: the ratio is the access cost, not
// the construction.
export function scan(seed: number): number {
  const n = 2048;
  const xs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    xs[i] = i * 7 + (seed | 0);
  }
  let total = 0;
  for (let round = 0; round < 64; round++) {
    for (let i = 1; i < n; i++) {
      total = total + xs[i]! * xs[i - 1]!;
    }
  }
  return total;
}
