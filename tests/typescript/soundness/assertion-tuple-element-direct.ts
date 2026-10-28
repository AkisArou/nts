/*---
description: A lying assertion function leaves a string in a claimed numeric tuple element through a direct read.
features: [ts-unsound-assertion, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberTuple(value: unknown): asserts value is [number, boolean] {}
const values: unknown = ["7", true];
assertNumberTuple(values);
assert.sameValue(typeof values[0], "string");
assert.sameValue(String(values[0] + 1), "71");
assert.sameValue(values[0] === 7, false);
assert.sameValue(values[1], true);
