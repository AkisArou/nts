/*---
description: A covariant write preserves the string through a numeric reduction of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-unions, ts-narrowing]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
const total = values.reduce<number>((sum: number, value: number | boolean) => {
  return typeof value === "boolean" ? sum : sum + value;
}, 2);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
