/*---
description: An append through another local name changes the original array's length.
features: [ts-proof-length, ts-route-alias, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 3 (docs/foundations/objects.md, Arrays).
// Route: a local alias appends; node reads 4 through the original, or 3 unchanged.
function lengthThroughOriginal(n: number): number {
  const xs = [10, 20, 30];
  const alias = xs;
  if (n > 0) alias.push(n);
  return xs.length;
}

for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthThroughOriginal(n), n > 0 ? 4 : 3);
}
