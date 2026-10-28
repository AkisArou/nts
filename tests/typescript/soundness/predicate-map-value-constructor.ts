/*---
description: A lying predicate leaves a string in a claimed numeric Map value through a copy constructor.
features: [ts-unsound-predicate, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberValues(value: unknown): value is Map<string, number> {
  return true;
}
const map: unknown = new Map<string, unknown>([["value", "7"]]);
if (!isNumberValues(map)) throw new Test262Error("predicate rejected the fixture");
const copy = new Map(map);
const value = copy.get("value");
if (value === undefined) throw new Test262Error("copied value is missing");
assert.sameValue(copy.size, 1);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
