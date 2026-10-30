/*---
description: A forEach callback changes the length of a captured allocation.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: the literal has length 2 (docs/foundations/objects.md, Arrays).
// Route: forEach callbacks unshift; node reads 2 + min(n, 4).
function lengthAfterForEach(n: number): number {
  const xs = [10, 20];
  [0, 1, 2, 3].forEach(step => {
    if (step < n) xs.unshift(step);
  });
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterForEach(n), 2 + (n < 4 ? n : 4));
}
