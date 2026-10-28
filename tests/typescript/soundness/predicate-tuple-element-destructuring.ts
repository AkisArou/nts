/*---
description: A lying predicate leaves a string in a claimed numeric tuple element through destructuring.
features: [ts-unsound-predicate, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberTuple(value: unknown): value is [number, boolean] {
  return true;
}
const values: unknown = ["7", true];
if (!isNumberTuple(values)) throw new Test262Error("predicate rejected the fixture");
const [value, marker] = values;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(marker, true);
