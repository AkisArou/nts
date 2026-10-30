/*---
description: A called index writer contributes NaN to the array element kind.
features: [ts-proof-element-kind, ts-route-call, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a callee stores NaN; a separate reader must observe NaN.
function readFirst(xs: number[]): number { return xs[0]; }
function write(xs: number[], n: number): void {
  if (n > 0) xs[0] = NaN;
}
function observe(n: number): number {
  const xs = [1, 2];
  write(xs, n);
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 1);
}
