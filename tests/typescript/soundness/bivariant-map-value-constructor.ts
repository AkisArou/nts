/*---
description: The Map copy constructor keeps a string stored in a number-valued source.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-conversions, ts-typeof-operator]
---*/
// TypeScript allows widening by method bivariance, so the source's number
// value type can be false. Node's Map constructor copies the actual string.
function insert(map: Map<string, unknown>): void {
  map.set("value", "7");
}
const map = new Map<string, number>();
insert(map);
const copy = new Map(map);
const value = copy.get("value");
if (value === undefined) throw new Test262Error("copied value is missing");
assert.sameValue(copy.size, 1);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
