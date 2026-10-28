/*---
description: A lying assertion function leaves a string in a claimed numeric object property through a direct read.
features: [ts-unsound-assertion, ts-objects, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberState(value: unknown): asserts value is { value: number } {}
const cell: unknown = { value: "7" };
assertNumberState(cell);
assert.sameValue(typeof cell.value, "string");
assert.sameValue(String(cell.value + 1), "71");
assert.sameValue(cell.value === 7, false);
