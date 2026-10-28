/*---
description: A lying predicate leaves a string in a claimed numeric array element through a number-typed call.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[1]), "string:71");
assert.sameValue(describe(values[0]), "number:3");
