/*---
description: A lying assertion function leaves a string in a claimed numeric object property through a spread copy.
features: [ts-unsound-assertion, ts-objects, ts-typeof-operator, ts-conversions, ts-spread, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole state,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberState(value: unknown): asserts value is { value: number } {}
const cell: unknown = { value: "7" };
assertNumberState(cell);
const copied = { ...cell };
assert.sameValue(typeof copied.value, "string");
assert.sameValue(String(copied.value + 1), "71");
assert.sameValue(JSON.stringify(copied), '{"value":"7"}');
