/*---
description: Explicit generic widening leaves a string in a numeric Set element through an Array.from copy.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const copied: number[] = Array.from(set);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1], "string");
assert.sameValue(String(copied[1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[2,"7"]');
