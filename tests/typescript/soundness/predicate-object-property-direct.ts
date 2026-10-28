/*---
description: A lying predicate leaves a string in a claimed numeric object property through a direct read.
features: [ts-unsound-predicate, ts-objects, ts-typeof-operator, ts-conversions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberState(value: unknown): value is { value: number } {
  return true;
}
const cell: unknown = { value: "7" };
if (!isNumberState(cell)) throw new Test262Error("predicate rejected the fixture");
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
