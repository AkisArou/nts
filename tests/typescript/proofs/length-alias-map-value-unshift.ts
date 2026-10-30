/*---
description: An array recovered from a Map changes the original array length.
features: [ts-proof-length, ts-route-alias, ts-functions, ts-iteration, ts-arrays, ts-map-set]
---*/
// Fact: the guard establishes length 3 (docs/foundations/objects.md, Arrays).
// Route: the Map value aliases its writer; node reads 4 after unshift.
function lengthThroughMap(n: number): number {
  const xs = [10, 20, 30];
  const aliases = new Map<string, number[]>([['items', xs]]);
  const alias = aliases.get('items');
  if (alias === undefined || xs.length !== 3) return -1;
  if (n > 0) alias.unshift(n);
  return xs.length;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(lengthThroughMap(n), n > 0 ? 4 : 3);
}
