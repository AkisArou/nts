/*---
description: Explicit generic widening leaves a string in a numeric array element through for-of iteration.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const seen: string[] = [];
for (const value of values) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
