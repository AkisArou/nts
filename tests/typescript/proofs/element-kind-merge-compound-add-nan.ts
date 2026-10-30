/*---
description: One compound-add branch makes an initially integral array element NaN.
features: [ts-proof-element-kind, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: one += branch stores NaN; a separate reader keeps it after the join.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(n: number): number {
  const xs = [7];
  if (n > 0) xs[0] += NaN;
  else xs[0] += 1;
  return readFirst(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? NaN : 8);
}
