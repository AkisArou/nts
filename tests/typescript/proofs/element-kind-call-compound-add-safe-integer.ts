/*---
description: A called compound store crosses the safe-integer limit of an array element.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: safe whole elements can use int64 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: += stores 2^53; the separate reader must round x + 1, giving gap 0.
function nextGap(xs: number[]): number {
  const x = xs[0];
  return (x + 1) - x;
}
function addOne(xs: number[], n: number): void {
  if (n > 0) xs[0] += 1;
}
function observe(n: number): number {
  const xs = [9007199254740991];
  addOne(xs, n);
  return nextGap(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0 : 1);
}
