/*---
description: Explicit generic widening leaves a string in a numeric array element through destructuring.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const [control, value] = values;
assert.sameValue(control, 2);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
