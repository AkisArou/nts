/*---
description: Explicit generic widening leaves a string in a numeric array element through a direct read.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
assert.sameValue(values.length, 2);
assert.sameValue(typeof values[1], "string");
assert.sameValue(String(values[1] + 1), "71");
assert.sameValue(values[1] === 7, false);
assert.sameValue(values[0] + 1, 3);
