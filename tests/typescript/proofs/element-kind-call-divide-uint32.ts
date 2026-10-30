/*---
description: A called compound division widens an int32 array element without wrapping.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: dividing by 0.5 stores 4294967294; a separate reader keeps that value.
function readFirst(xs: number[]): number { return xs[0]; }
function divide(xs: number[], n: number): void {
  if (n > 0) xs[0] /= 0.5;
}
function observe(n: number): number {
  const xs = [2147483647];
  divide(xs, n);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 4294967294 : 2147483647);
}
