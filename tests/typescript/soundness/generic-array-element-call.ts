/*---
description: Explicit generic widening leaves a string in a numeric array element through a numeric parameter.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[1]), "string:71");
assert.sameValue(describe(values[0]), "number:3");
