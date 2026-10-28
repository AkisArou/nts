/*---
description: A lying assertion function leaves a string in a claimed numeric object property through a number-typed return.
features: [ts-unsound-assertion, ts-objects, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberState(value: unknown): asserts value is { value: number } {}
const cell: unknown = { value: "7" };
assertNumberState(cell);
function read(cell: { value: number }): number {
  return cell.value;
}
const value: number = read(cell);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
