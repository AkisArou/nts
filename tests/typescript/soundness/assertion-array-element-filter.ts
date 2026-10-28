/*---
description: A lying assertion function leaves a string in a claimed numeric array element through filter.
features: [ts-unsound-assertion, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-assertion-functions, ts-narrowing, ts-unknown]
---*/
// TypeScript trusts the lying assertion function for this whole container,
// although a claimed numeric member is a string. Node preserves the actual string.
function assertNumberArray(value: unknown): asserts value is number[] {}
const values: unknown = [2, "7"];
assertNumberArray(values);
const kept: number[] = values.filter((value: number) => value !== 2);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
assert.sameValue(kept[0] === 7, false);
