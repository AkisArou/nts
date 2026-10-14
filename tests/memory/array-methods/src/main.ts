// What a predicate over an array costs, which is nothing, and what `filter`
// costs, which is one allocation.
//
// `some`, `every` and `findIndex` carry their answer the way `reduce` carries
// an accumulator: a boolean or an index, both scalars, neither a reference, and
// none of them needing storage that outlives an iteration. So three of the four
// are here to assert a zero. If one of them ever allocates it is because the
// answer stopped being loop-carried, and that is the regression worth catching.
//
// `filter` cannot be free -- its result is a new array -- but it can be *one*,
// which is the claim the number below makes.

export function work(n: number): number {
  const xs: number[] = [];
  for (let i = 0; i < 16 + n; i = i + 1) {
    xs.push(i);
  }

  let total = 0;
  // Stops early.
  if (xs.some((v) => v === 4)) {
    total = total + 1;
  }
  // Runs to the end and never decides.
  if (xs.some((v) => v === 100000)) {
    total = total + 2;
  }
  if (xs.every((v) => v >= 0)) {
    total = total + 4;
  }
  // Fails at the first element.
  if (xs.every((v) => v > 0)) {
    total = total + 8;
  }
  total = total + xs.findIndex((v) => v === 7);
  total = total + xs.findIndex((v) => v === 100000);

  const kept = xs.filter((v) => v > 8);
  return total + kept.length;
}
