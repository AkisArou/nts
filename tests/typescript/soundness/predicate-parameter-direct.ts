/*---
description: A lying predicate leaves a string in a claimed numeric parameter through a direct read.
features: [ts-unsound-predicate, ts-functions, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate and accepts the string at a
// number parameter. Node passes the actual string, so adding one concatenates.
function isNumber(value: unknown): value is number {
  return true;
}
function inspect(value: number): void {
  assert.sameValue(typeof value, "string");
  assert.sameValue(String(value + 1), "71");
  assert.sameValue(value === 7, false);
}
const value: unknown = "7";
if (!isNumber(value)) throw new Test262Error("predicate rejected the fixture");
inspect(value);
