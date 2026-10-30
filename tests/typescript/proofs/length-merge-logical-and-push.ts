/*---
description: A short-circuit append invalidates an exact length on its taken edge.
features: [ts-proof-length, ts-route-merge, ts-arrays, ts-expressions, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: && merges a skipped push with an executed push; node reads 4 or 5.
function lengthAfterAnd(n: number): number {
  const xs = [10, 20, 30, 40];
  n > 0 && xs.push(n);
  return xs.length;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthAfterAnd(n), n > 0 ? 5 : 4);
}
