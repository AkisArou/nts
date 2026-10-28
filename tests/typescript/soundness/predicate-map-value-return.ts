/*---
description: A lying predicate leaves a string in a claimed numeric Map value through a number-typed return.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
function read(map: Map<string, number>): number {
  const value = map.get("value");
  if (value === undefined) throw new Test262Error("stored value is missing");
  return value;
}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const value: number = read(map);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
