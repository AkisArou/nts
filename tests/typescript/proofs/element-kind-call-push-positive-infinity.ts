/*---
description: A called push preserves positive infinity in an initially integral array.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee pushes Infinity; a separate reader observes Infinity.
function readLast(xs: number[]): number { return xs[xs.length - 1]; }
function append(xs: number[], n: number): void {
  if (n > 0) xs.push(Infinity);
}
function observe(n: number): number {
  const xs = [1, 2];
  append(xs, n);
  return readLast(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? Infinity : 2);
}
