/*---
description: A lying assertion function leaves a string in a claimed numeric parameter through a direct read.
features: [ts-unsound-assertion, ts-functions, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function assertNumber(value: unknown): asserts value is number {}
function inspect(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
  assert.sameValue(value === 7, false);
}
const value: unknown = "7";
assertNumber(value);
inspect(value);
