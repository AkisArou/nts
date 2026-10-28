/*---
description: A string key read through a number-keyed Map reaches a number parameter unchanged.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions]
---*/
// TypeScript's method bivariance permits a wider Map parameter to store a
// string key. Node preserves that string when the original number view reads it.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map = new Map<number, number>();
insert(map);
const [key] = map.keys();
assert.sameValue(describe(key), "string:71");
