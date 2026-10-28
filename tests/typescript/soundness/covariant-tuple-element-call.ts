/*---
description: A covariant write preserves the string through a numeric parameter of a numeric tuple slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: [number, boolean] = [0, true];
const wider: [unknown, boolean] = values;
wider[0] = "7";
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[0]), "string:71");
assert.sameValue(values[1], true);
