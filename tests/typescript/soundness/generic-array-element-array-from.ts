/*---
description: Explicit generic widening leaves a string in a numeric array element through an Array.from copy.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const copy: number[] = Array.from(values);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(String(copy[1] + 1), "71");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
