/*---
description: A conditional operand merges an existing integer with a new fractional Set entry.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-spread]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the conditional add joins a duplicate integer control with a fractional insertion.
function read(items: Set<number>): number {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  items.add(n > 0 ? n + 0.25 : 2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.25 : 2);
}
