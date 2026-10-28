/*---
description: Destructuring a number-keyed Map binds the string key stored through a wider parameter.
features: [ts-unsound-bivariance, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring]
---*/
// TypeScript's method bivariance permits a wider Map parameter to store a
// string key. Node preserves that string when the original number view reads it.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>();
insert(map);
const [[key, value]] = map;
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
assert.sameValue(value, 70);
