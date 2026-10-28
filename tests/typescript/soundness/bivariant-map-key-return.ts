/*---
description: A function returning a number preserves a string key read from a number-keyed Map.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions]
---*/
// TypeScript's method bivariance permits a wider Map parameter to store a
// string key. Node preserves that string when the original number view reads it.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
function firstKey(map: Map<number, number>): number {
  const [key] = map.keys();
  return key;
}
const map = new Map<number, number>();
insert(map);
const key: number = firstKey(map);
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
