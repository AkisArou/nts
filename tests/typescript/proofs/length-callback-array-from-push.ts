/*---
description: Array.from's map function appends to a captured empty array before its length is read.
features: [ts-proof-length, ts-route-callback, ts-arrays, ts-arrow-functions, ts-closures, ts-functions, ts-iteration, ts-objects]
---*/
// Fact: the target literal has length 0 (docs/foundations/objects.md, Arrays).
// Route: Array.from's map function appends; node reads count, including zero.
function lengthAfterFrom(count: number): number {
  const xs: number[] = [];
  Array.from({ length: count }, (_, index) => {
    xs.push(index);
    return index;
  });
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterFrom(n), n);
}
