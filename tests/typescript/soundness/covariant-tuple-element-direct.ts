/*---
description: A covariant write preserves the string through an indexed read of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
assert.sameValue(typeof values[0], "string");
assert.sameValue(String(values[0] + 1), "71");
assert.sameValue(values[0] === 7, false);
assert.sameValue(values[1], true);
