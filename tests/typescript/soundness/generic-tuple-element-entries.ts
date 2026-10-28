/*---
description: Explicit generic widening leaves a string in a numeric tuple element through entries iteration.
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
for (const entry of values.entries()) {
  const value = entry[1];
  const text = typeof value === "boolean" ? "boolean:" + String(value) : typeof value + ":" + String(value + 1);
  seen.push(entry[0] + ":" + text);
}
assert.compareArray(seen, ["0:string:71", "1:boolean:true"]);
