/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a numeric parameter.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
assert.sameValue(describe(values[0]), "string:71");
assert.sameValue(values[1], true);
