/*---
description: Explicit generic widening leaves a string in a numeric array element through a numeric reduction.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const total: number = values.reduce((sum: number, value: number) => sum + value, 0);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
