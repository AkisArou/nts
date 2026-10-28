/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a numeric reduction.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const total = values.reduce<number>((sum: number, value: number | boolean) => {
  return typeof value === "boolean" ? sum : sum + value;
}, 2);
assert.sameValue(typeof total, "string");
assert.sameValue(String(total + 1), "271");
