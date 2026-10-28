/*---
description: A covariant write preserves the string through a filter result of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-unions, ts-narrowing]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
const kept = values.filter((value: number | boolean): boolean => typeof value !== "boolean");
assert.sameValue(kept.length, 1);
const value = kept[0];
if (typeof value === "boolean") throw new Test262Error("filter kept the marker");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
