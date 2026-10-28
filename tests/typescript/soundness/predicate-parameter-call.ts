/*---
description: A lying predicate leaves a string in a claimed numeric parameter through a number-typed call.
features: [ts-unsound-predicate, ts-functions, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function isNumber(value: unknown): value is number {
  return true;
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
function forward(value: number): string {
  return describe(value);
}
const value: unknown = "7";
if (!isNumber(value)) throw new Test262Error("predicate rejected the fixture");
assert.sameValue(forward(value), "string:71");
