// `some`, `every`, `findIndex` and `filter`, each compiled as the loop it is:
// no closure allocated, no indirect call, the predicate's body inlined into the
// caller, and the answer carried in a block parameter rather than a cell.
//
// The four differ in what stops them and what they carry, and one round asks
// all four so that no single one is the whole measurement:
//
//   some        stops at the first match, which the target moves
//   every       never decides, so it walks the whole array every round
//   findIndex   stops where it finds, carrying an index rather than a flag
//   filter      allocates, and is the only one of the four that does
//
// Separate from `array-methods`, which measures the ones that take a value
// rather than a function -- `indexOf`, `includes`, `fill`, `reverse`. What is
// being measured here is the inlined callback.
//
// **Everything depends on `seed`.** Written with a constant array and a
// constant predicate this measures nothing: the round is loop-invariant, V8
// hoists it, and node reports a time for work it did once.
export function predicates(seed: number): number {
  const n = 256 + (seed | 0);
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    xs.push(i * 7 + seed);
  }

  let total = 0;
  for (let round = 0; round < 8; round++) {
    const target = round * 13 + seed;
    if (xs.some((v) => v === target)) {
      total = (total + 1) | 0;
    }
    // Never false, so this one walks all of it.
    if (xs.every((v) => v >= 0)) {
      total = (total + 2) | 0;
    }
    total = (total + xs.findIndex((v) => v > target)) | 0;
    const kept = xs.filter((v) => v > target);
    total = (total + kept.length) | 0;
  }
  return total;
}
