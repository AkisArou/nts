/*---
description: A called fill contributes fractional values to the array element kind.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee fills with 3.5; a separate reader keeps the fraction.
function readSecond(xs: number[]): number { return xs[1]; }
function fill(xs: number[], n: number): void {
  if (n > 0) xs.fill(3.5);
}
function observe(n: number): number {
  const xs = [1, 2, 3];
  fill(xs, n);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 3.5 : 2);
}
