/*---
description: Joining integral and NaN pushes preserves NaN in a separate array reader.
features: [ts-proof-element-kind, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: one branch pushes NaN; the joined read elsewhere must observe NaN.
function readLast(xs: number[]): number { return xs[xs.length - 1]; }
function observe(n: number): number {
  const xs = [1, 2];
  if (n > 0) xs.push(NaN);
  else xs.push(3);
  return readLast(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 3);
}
