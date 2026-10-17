// A branch on `!c` bounds what `c` compares, as a branch on `c` does.
//
// `flow` narrows a value on each edge of a branch whose condition is a
// comparison: `if (i < n)` makes `i < n` on one edge and `i >= n` on the
// other. A condition that *negated* a comparison narrowed nothing, so
// `while (!(at > top))` let `at` go round with no upper bound: it widened to
// infinity and stayed a double, and so did everything computed from it. It is
// also the shape a hand-written iterator's `{ value, done }` takes once it is a
// value rather than an object: `!done`, `done` a comparison --
// `benchmarks/cases/user-iterable`.
//
// `countup` is that loop. `plain` is the control, one change from it: the same
// loop guarded by `at <= top`, which always narrowed.
//
// expect-ir: all: block params in countup are integer
// expect-ir: all: block params in plain are integer

export function countup(limit: number): number {
  const top = (limit | 0) & 1023;
  let at = 0;
  let total = 0;
  while (!(at > top)) {
    total = (total + at) | 0;
    at = at + 1;
  }
  return total;
}

export function plain(limit: number): number {
  const top = (limit | 0) & 1023;
  let at = 0;
  let total = 0;
  while (at <= top) {
    total = (total + at) | 0;
    at = at + 1;
  }
  return total;
}
