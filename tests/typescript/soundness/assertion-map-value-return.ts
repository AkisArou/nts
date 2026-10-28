/*---
description: A lying assertion function leaves a string in a claimed numeric Map value through a number-typed return.
features: [ts-unsound-assertion, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberValues(value: unknown): asserts value is Map<string, number> {}
function read(map: Map<string, number>): number {
  const value = map.get("value");
  if (value === undefined) throw new Test262Error("stored value is missing");
  return value;
}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
assertNumberValues(map);
const value: number = read(map);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
