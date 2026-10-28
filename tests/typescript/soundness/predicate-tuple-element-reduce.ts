/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through reduce.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberTuple(value: unknown): value is [number, boolean] {
  return true;
}
const values: unknown = ["7", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
const total = values.reduce<number>((sum: number, value: number | boolean) => {
  return typeof value === "boolean" ? sum : sum + value;
}, 2);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
