/*---
description: Explicit generic widening leaves a string in a numeric tuple element through Array.from's mapping callback.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-functions, ts-generics, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const seen = Array.from(values, (value: number | boolean) => {
  return typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
});
assert.compareArray(seen, ["string:71", "boolean:true"]);
