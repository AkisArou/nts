/*---
description: A covariant write preserves the string through Array.from's mapping callback of a numeric array slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-functions]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: number[] = [2, 0];
const wider: unknown[] = values;
wider[1] = "7";
const seen = Array.from(values, (value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
