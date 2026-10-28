/*---
description: Explicit generic widening leaves a string in a numeric Set element through Array.from's mapping callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const seen = Array.from(set, (value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
