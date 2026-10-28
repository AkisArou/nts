/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through a number-typed return.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberTuple(value: unknown): value is [number, boolean] {
  return true;
}
const values: unknown = ["7", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
function read(values: [number, boolean]): number {
  return values[0];
}
const value: number = read(values);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(values[1], true);
