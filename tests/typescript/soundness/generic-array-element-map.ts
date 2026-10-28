/*---
description: Explicit generic widening leaves a string in a numeric array element through a map callback.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const seen = values.map((value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
