/*---
description: A called splice contributes a fraction while retaining the array length.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee splices in 0.25; a separate reader keeps exactly 0.25.
function readSecond(xs: number[]): number { return xs[1]; }
function replace(xs: number[], n: number): void {
  if (n > 0) xs.splice(1, 1, 0.25);
}
function observe(n: number): number {
  const xs = [1, 2, 3];
  replace(xs, n);
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0.25 : 2);
}
