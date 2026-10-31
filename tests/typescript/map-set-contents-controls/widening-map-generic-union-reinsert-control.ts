/*---
description: Control for widening-map-generic-union-reinsert; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-map-generic-union-reinsert.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(map: Map<string, number | string>, value: number | string): void {
  map.delete("first");
  map.set("first", value);
}
function check(n: number): void {
  const map = new Map<string, number | string>([["first", n], ["keep", n + 1]]);
  const text = "item:" + String(n);
  write(map, text);
  const value = map.get("first");
  assert.sameValue<unknown>(value, text);
  assert.sameValue(typeof value, "string");
  assert.sameValue(map.size, 2);
  assert.compareArray([...map.keys()], ["keep", "first"]);
  assert.compareArray<unknown>([...map.values()], [n + 1, text]);
  assert.compareArray([...map.values()].map(value => typeof value), ["number", "string"]);
}
for (const n of [-3, 0, 7]) check(n);
