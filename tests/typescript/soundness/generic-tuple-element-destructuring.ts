/*---
description: Explicit generic widening leaves a string in a numeric tuple element through destructuring.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const [value, marker] = values;
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(marker, true);
