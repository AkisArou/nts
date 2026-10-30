/*---
description: Splice branches join at an array read that preserves a value beyond int32.
features: [ts-proof-element-kind, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: one branch splices in 2147483648; the separate joined read keeps it.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const xs = [1, 2, 3];
  if (n > 0) xs.splice(1, 1, 2147483648);
  else xs.splice(1, 1, 2);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 2147483648 : 2);
}
