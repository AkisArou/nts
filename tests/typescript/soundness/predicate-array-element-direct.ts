/*---
description: A lying predicate leaves a string in a claimed numeric array element through a direct read.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
assert.sameValue(values.length, 2);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1] + 1), "71");
assert.sameValue(values[1] === 7, false);
assert.sameValue(values[0] + 1, 3);
