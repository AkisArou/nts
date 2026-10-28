/*---
description: A lying assertion function leaves a string in a claimed numeric parameter through a number-typed call.
features: [ts-unsound-assertion, ts-functions, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function assertNumber(value: unknown): asserts value is number {}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
function forward(value: number): string {
  return describe(value);
}
const value: unknown = "7";
assertNumber(value);
assert.sameValue(forward(value), "string:71");
