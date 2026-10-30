/*---
description: Pops from a reducer invalidate a different array's allocation length.
features: [ts-proof-length, ts-route-callback, ts-arrays, ts-arrow-functions, ts-closures, ts-functions, ts-iteration]
---*/
// Fact: the target literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: reduce calls a captured pop; node reads max(4 - limit, 0) afterwards.
function lengthAfterReduce(limit: number): number {
  const xs = [10, 20, 30, 40];
  [1, 2, 3, 4].reduce((sum, value) => {
    if (value <= limit) xs.pop();
    return sum + value;
  }, 0);
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthAfterReduce(n), n < 4 ? 4 - n : 0);
}
