/*---
description: A conditional splice changes the length seen after both expression arms join.
features: [ts-proof-length, ts-route-merge, ts-functions, ts-iteration, ts-arrays, ts-expressions]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: ?: chooses whether to splice; node reads 4 or max(4 - n, 0).
function lengthAfterConditional(n: number): number {
  const xs = [10, 20, 30, 40];
  n > 0 ? xs.splice(0, n) : [];
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterConditional(n), n < 4 ? 4 - n : 0);
}
