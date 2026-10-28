/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a direct read.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
assert.sameValue(typeof values[0], "string");
assert.sameValue(String(values[0] + 1), "71");
assert.sameValue(values[0] === 7, false);
assert.sameValue(values[1], true);
