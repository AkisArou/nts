/*---
description: Explicit generic widening leaves a string in a numeric array element through entries iteration.
features: [ts-unsound-generic-widening, ts-arrays, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-generics, ts-functions]
---*/
// TypeScript accepts the numeric array at an explicit unknown instantiation.
// The generic write breaks its number claim; node preserves the actual string.
function write<T>(values: T[], value: T): void {
  values[1] = value;
}
const values: number[] = [2, 0];
write<unknown>(values, "7");
const seen: string[] = [];
for (const entry of values.entries()) {
  seen.push(entry[0] + ":" + typeof entry[1] + ":" + String(entry[1] + 1));
}
assert.compareArray(seen, ["0:number:3", "1:string:71"]);
