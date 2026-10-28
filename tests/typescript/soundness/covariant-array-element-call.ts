/*---
description: A string from a numeric array crosses a numeric parameter and return without conversion.
features: [ts-unsound-covariant-array, ts-arrays, ts-functions, ts-conversions, ts-typeof-operator]
---*/
// TypeScript allows a wider array writer to inject a string, yet accepts the
// element at a number parameter. Node concatenates and returns a string.
function append(values: unknown[]): void {
  values.push("7");
}
function plusOne(value: number): number {
  return value + 1;
}
const values: number[] = [2];
append(values);
const result: number = plusOne(values[1]);
assert.sameValue(typeof result, "string");
assert.sameValue(String(result), "71");
assert.sameValue(plusOne(values[0]), 3);
