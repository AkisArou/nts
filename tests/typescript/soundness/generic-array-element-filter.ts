/*---
description: Explicit generic widening leaves a string in a numeric array element through a filter result.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-functions, ts-generics]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const kept: number[] = values.filter((value: number) => value !== 2);
assert.sameValue(kept.length, 1);
assert.sameValue(typeof kept[0], "string");
assert.sameValue(String(kept[0] + 1), "71");
assert.sameValue(kept[0] === 7, false);
