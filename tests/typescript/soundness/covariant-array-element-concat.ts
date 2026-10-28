/*---
description: A covariant write preserves the string through a concat copy of a numeric array slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: number[] = [2, 0];
const wider: unknown[] = values;
wider[1] = "7";
const copy: number[] = values.concat([3]);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(String(copy[1] + 1), "71");
assert.sameValue(JSON.stringify(copy), '[2,"7",3]');
