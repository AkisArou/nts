/*---
description: Explicit generic widening leaves a string in a numeric tuple element through values iteration.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const seen: string[] = [];
for (const value of values.values()) {
  if (typeof value === "boolean") seen.push("boolean:" + String(value));
  else seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["string:71", "boolean:true"]);
