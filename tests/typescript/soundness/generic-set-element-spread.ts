/*---
description: Explicit generic widening leaves a string in a numeric Set element through a spread copy.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-generics, ts-arrays, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const copy = [...set];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
