/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through a number-typed call.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[0]), "string:71");
assert.sameValue(values[1], true);
