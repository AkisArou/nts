/*---
description: A second variable inserts a fraction into the same initially integral Set.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-spread]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: a second local names the original Set and performs its fractional insertion.
function read(items: Set<number>): number {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const alias = items;
  if (n > 0) alias.add(n + 0.5);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
