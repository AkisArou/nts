/*---
description: Map callbacks splice a captured array before its length is read.
features: [ts-proof-length, ts-route-callback, ts-functions, ts-iteration, ts-arrays, ts-closures, ts-arrow-functions]
---*/
// Fact: the literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: map calls splice through a capture; node reads 4 - min(n, 3).
function lengthAfterMapCallbacks(n: number): number {
  const xs = [10, 20, 30, 40];
  [0, 1, 2].map(step => {
    if (step < n) xs.splice(0, 1);
    return step;
  });
  return xs.length;
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterMapCallbacks(n), 4 - (n < 3 ? n : 3));
}
