/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through reduce.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown, ts-unions]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const total = values.reduce<number>((sum: number, value: number | boolean) => {
  return typeof value === "boolean" ? sum : sum + value;
}, 2);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
