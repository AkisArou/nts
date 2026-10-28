/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through a number-typed call.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
assertNumberValues(map);
const value = map.get("value");
if (value === undefined) throw new Test262Error("stored value is missing");
assert.sameValue(describe(value), "string:71");
