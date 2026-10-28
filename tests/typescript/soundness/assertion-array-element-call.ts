/*---
description: A lying assertion function leaves a string in a claimed numeric array element through a number-typed call.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[1]), "string:71");
assert.sameValue(describe(values[0]), "number:3");
