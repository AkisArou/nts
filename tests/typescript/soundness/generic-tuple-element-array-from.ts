/*---
description: Explicit generic widening leaves a string in a numeric tuple element through an Array.from copy.
features: [ts-unsound-generic-widening, ts-arrays, ts-tuples, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions, ts-unions, ts-narrowing]
---*/
// TypeScript accepts the numeric tuple at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: [T, boolean], value: T): void {
  values[0] = value;
}
const values: [number, boolean] = [0, true];
write<unknown>(values, "7");
const copy = Array.from(values);
const value = copy[0];
if (typeof value === "boolean") throw new Test262Error("numeric slot became boolean");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
assert.sameValue(JSON.stringify(copy), '["7",true]');
