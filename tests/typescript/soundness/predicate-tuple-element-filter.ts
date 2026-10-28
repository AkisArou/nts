/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through filter.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberTuple(value: unknown): value is [number, boolean] {
  return true;
}
const values: unknown = ["7", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
const kept = values.filter((value: number | boolean): boolean => typeof value !== "boolean");
assert.sameValue(kept.length, 1);
const value = kept[0];
if (typeof value === "boolean") throw new Test262Error("filter kept the marker");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
