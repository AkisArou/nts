/*---
description: Map get reads a string stored through a wider view of number values.
features: [ts-unsound-bivariance, ts-map-set, ts-conversions, ts-typeof-operator]
---*/
// TypeScript's method bivariance allows the wider map parameter to write a
// string into a number-valued map. Node returns it, and adding one concatenates.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>();
insert(map);
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(value === 7, false);
