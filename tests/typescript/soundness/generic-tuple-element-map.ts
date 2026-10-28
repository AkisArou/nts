/*---
description: Explicit generic widening leaves a string in a numeric tuple element through a map callback.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-functions, ts-generics, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const seen = values.map((value: number | boolean) => {
  return typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
});
assert.compareArray(seen, ["string:71", "boolean:true"]);
