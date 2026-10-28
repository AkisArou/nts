/*---
description: A lying assertion function leaves a string in a claimed numeric array element through reduce.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
const total: number = values.reduce((sum: number, value: number) => sum + value, 0);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
