/*---
description: Map.forEach callbacks grow an array from its known literal length.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions, ts-map-set]
---*/
// Fact: the literal has length 1 (docs/foundations/objects.md, Arrays).
// Route: Map.forEach runs captured pushes; node reads 1 + min(n, 3).
function lengthAfterMapForEach(n: number): number {
  const entries = new Map<number, number>([[0, 4], [1, 5], [2, 6]]);
  const xs = [10];
  entries.forEach((value, key) => {
    if (key < n) xs.push(value);
  });
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterMapForEach(n), 1 + (n < 3 ? n : 3));
}
