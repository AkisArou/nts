/*---
description: A covariant write preserves the string through a numeric return of a numeric array slot.
features: [ts-unsound-covariant-array, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions]
---*/
// TypeScript allows this mutable array or tuple to widen covariantly,
// admitting a string into a numeric slot. Node preserves the actual string.
const values: number[] = [2, 0];
const wider: unknown[] = values;
wider[1] = "7";
function read(): number {
  return values[1];
}
const value: number = read();
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
