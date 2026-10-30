/*---
description: An if-else joins a string insertion with a duplicate integer insertion into the same Set.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-strings, ts-spread, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the two branch writers meet before a common read of the originally numeric Set.
function read(items: Set<number | string>): number | string {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number | string {
  const items = new Set<number | string>([1, 2]);
  if (n > 0) items.add("item:" + n);
  else items.add(2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "string" : "number");
  assert.sameValue(result, n > 0 ? "item:" + n : 2);
}
