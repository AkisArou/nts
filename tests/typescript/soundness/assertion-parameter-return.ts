/*---
description: A lying assertion function leaves a string in a claimed numeric parameter through a number-typed return.
features: [ts-unsound-assertion, ts-functions, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function assertNumber(value: unknown): asserts value is number {}
function identity(value: number): number {
  return value;
}
const value: unknown = "7";
assertNumber(value);
const result: number = identity(value);
assert.sameValue(typeof result, "string");
assert.sameValue(String(result + 1), "71");
