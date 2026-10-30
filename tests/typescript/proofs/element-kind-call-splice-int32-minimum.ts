/*---
description: A called splice introduces a negative int32 value among small positive elements.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee splices in -2147483648; the separate read keeps its sign.
function readFirst(xs: number[]): number { return xs[0]; }
function replace(xs: number[], n: number): void {
  if (n > 0) xs.splice(0, 1, -2147483648);
}
function observe(n: number): number {
  const xs = [1, 2];
  replace(xs, n);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -2147483648 : 1);
}
