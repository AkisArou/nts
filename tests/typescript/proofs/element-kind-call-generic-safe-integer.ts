/*---
description: A generic store crosses the safe-integer limit and requires rounded element arithmetic.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-generics]
---*/
// Fact: safe whole elements can use int64 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a generic call stores 2^53; the separate reader must give gap 0.
function store<T>(xs: T[], value: T): void { xs[0] = value; }
function nextGap(xs: number[]): number {
  const x = xs[0];
  return (x + 1) - x;
}
function observe(n: number): number {
  const xs = [9007199254740991];
  store<number>(xs, 9007199254740991);
  if (n > 0) store<number>(xs, 9007199254740992);
  return nextGap(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0 : 1);
}
