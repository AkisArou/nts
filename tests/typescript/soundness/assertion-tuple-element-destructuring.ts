/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through destructuring.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
const [value, marker] = values;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(marker, true);
