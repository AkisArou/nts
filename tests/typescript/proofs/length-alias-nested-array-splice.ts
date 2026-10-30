/*---
description: A splice through an outer array's element changes the original inner array's length.
features: [ts-proof-length, ts-route-alias, ts-arrays, ts-functions, ts-iteration]
---*/
// Fact: the inner literal has length 4 (docs/foundations/objects.md, Arrays).
// Route: an alias stored in another array is spliced; node reads 4, 3, or 1.
function lengthThroughInner(n: number): number {
  const xs = [10, 20, 30, 40];
  const rows: number[][] = [xs];
  rows[0].splice(1, n);
  return xs.length;
}

for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(lengthThroughInner(n), n === 0 ? 4 : n === 1 ? 3 : 1);
}
