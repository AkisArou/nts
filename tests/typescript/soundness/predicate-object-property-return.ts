/*---
description: A lying predicate leaves a string in a claimed numeric object property through a number-typed return.
features: [ts-unsound-predicate, ts-objects, ts-typeof-operator, ts-conversions, ts-functions, ts-type-guards, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying predicate for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function isNumberState(value: unknown): value is { value: number } {
  return true;
}
const cell: unknown = { value: "7" };
if (!isNumberState(cell)) throw new Test262Error("predicate rejected the fixture");
function read(cell: { value: number }): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
