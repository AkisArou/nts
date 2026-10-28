/*---
description: A covariant write preserves the string through a concat copy of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-unions, ts-narrowing]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
const copy = values.concat([3]);
const value = copy[0];
if (typeof value === "boolean") throw new Test262Error("numeric slot became boolean");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(JSON.stringify(copy), '["7",true,3]');
