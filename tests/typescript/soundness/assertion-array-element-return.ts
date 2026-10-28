/*---
description: A lying assertion function leaves a string in a claimed numeric array element through a number-typed return.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
function read(values: number[]): number {
  return values[1];
}
const value: number = read(values);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
