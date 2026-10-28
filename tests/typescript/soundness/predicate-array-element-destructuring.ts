/*---
description: A lying predicate leaves a string in a claimed numeric array element through destructuring.
features: [ts-unsound-predicate, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberArray(value: unknown): value is number[] {
  return true;
}
const values: unknown = [2, "7"];
if (!isNumberArray(values)) throw new Test262Error("predicate rejected the fixture");
const [control, value] = values;
assert.sameValue(control, 2);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
