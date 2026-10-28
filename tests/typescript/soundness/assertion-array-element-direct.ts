/*---
description: A lying assertion function leaves a string in a claimed numeric array element through a direct read.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
assert.sameValue(values.length, 2);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1] + 1), "71");
assert.sameValue(values[1] === 7, false);
assert.sameValue(values[0] + 1, 3);
