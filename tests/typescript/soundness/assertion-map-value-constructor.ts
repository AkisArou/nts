/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through a copy constructor.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
assertNumberValues(map);
const copy = new Map(map);
const value = copy.get("value");
if (value === undefined) throw new Test262Error("copied value is missing");
assert.sameValue(copy.size, 1);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
