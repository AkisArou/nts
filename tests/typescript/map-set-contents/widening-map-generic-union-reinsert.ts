/*---
description: A generic union writer reinserts an entry later read through a numeric Map type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a generic number|string instantiation deletes and writes a numeric Map, then narrow get reads it; node keeps the exact contents and order.
function write<V>(map: Map<string, V>, value: V): void {
  map.delete("first");
  map.set("first", value);
}
function check(n: number): void {
  const map = new Map<string, number>([["first", n], ["keep", n + 1]]);
  const text = "item:" + String(n);
  write<number | string>(map, text);
  const value = map.get("first");
  assert.sameValue<unknown>(value, text);
  assert.sameValue(typeof value, "string");
  assert.sameValue(map.size, 2);
  assert.compareArray([...map.keys()], ["keep", "first"]);
  assert.compareArray<unknown>([...map.values()], [n + 1, text]);
  assert.compareArray([...map.values()].map(value => typeof value), ["number", "string"]);
}
for (const n of [-3, 0, 7]) check(n);
