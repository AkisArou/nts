/*---
description: Destructuring a Map preserves a string read through its number value type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-destructuring, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance admits the wider map and its string write.
// Node binds the actual string to the number-typed destructured value.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>();
insert(map);
const [[key, value]] = map;
assert.sameValue(key, "value");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
