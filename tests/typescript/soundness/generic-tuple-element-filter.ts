/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a filter result.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const kept = values.filter((value: number | boolean): boolean => typeof value !== "boolean");
assert.sameValue(kept.length, 1);
const value = kept[0];
if (typeof value === "boolean") throw new Test262Error("filter kept the marker");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
