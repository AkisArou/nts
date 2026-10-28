/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through get.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
assertNumberValues(map);
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(value === 7, false);
