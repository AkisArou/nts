/*---
description: A lying predicate leaves a string in a claimed numeric parameter through a number-typed return.
features: [ts-unsound-predicate, ts-functions, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function isNumber(value: unknown): value is number {
  return true;
}
function identity(value: number): number {
  return value;
}
const value: unknown = "7";
if (!isNumber(value)) throw new Test262Error("predicate rejected the fixture");
const result: number = identity(value);
assert.sameValue(typeof result, "string");
assert.sameValue(String(result + 1), "71");
