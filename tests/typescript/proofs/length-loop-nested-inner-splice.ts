/*---
description: Nested loop splices invalidate the outer allocation length.
features: [ts-proof-length, ts-route-loop, ts-functions, ts-iteration, ts-arrays]
---*/
// Fact: the literal has length 8 (docs/foundations/objects.md, Arrays).
// Route: inner iterations splice it; node reads 8, 5, 2, then 0.
function lengthAfterNestedSplices(turns: number): number {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8];
  for (let outer = 0; outer < 3; outer++) {
    for (let inner = 0; inner < turns; inner++) xs.splice(0, 1);
  }
  return xs.length;
}
for (const n of [0, 1, 2, 3, 4, 7]) {
  assert.sameValue(lengthAfterNestedSplices(n), n < 3 ? 8 - 3 * n : 0);
}
