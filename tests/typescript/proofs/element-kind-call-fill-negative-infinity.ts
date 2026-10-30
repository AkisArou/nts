/*---
description: A called fill preserves negative infinity in an initially integral array.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee fills with -Infinity; a separate reader observes -Infinity.
function readSecond(xs: number[]): number { return xs[1]; }
function fill(xs: number[], n: number): void {
  if (n > 0) xs.fill(-Infinity);
}
function observe(n: number): number {
  const xs = [1, 2, 3];
  fill(xs, n);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -Infinity : 2);
}
