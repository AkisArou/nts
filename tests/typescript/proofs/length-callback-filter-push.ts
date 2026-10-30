/*---
description: Appends from filter's callback change the filtered source's current length.
features: [ts-proof-length, ts-route-callback, ts-arrays, ts-arrow-functions, ts-closures, ts-functions, ts-iteration]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: filter's callback appends; node reads 4 + min(limit, 4) afterwards.
function lengthAfterFilter(limit: number): number {
  const xs = [1, 2, 3, 4];
  xs.filter(value => {
    if (value <= limit) xs.push(value + 10);
    return true;
  });
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterFilter(n), 4 + (n < 4 ? n : 4));
}
