/*---
description: An aliased push widens the original array element beyond int32.
features: [ts-proof-element-kind, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a second name pushes 2147483648; the original array reader keeps it.
function readLast(xs: number[]): number { return xs[xs.length - 1]; }
function observe(n: number): number {
  const xs = [1, 2];
  const alias = xs;
  if (n > 0) alias.push(2147483648);
  return readLast(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 2147483648 : 2);
}
