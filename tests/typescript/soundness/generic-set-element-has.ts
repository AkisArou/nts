/*---
description: Explicit generic widening leaves a string in a numeric Set element through a has lookup.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>();
insert<unknown>(set, "7");
// Recover the existing nominal-number member to call the narrow has method.
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(set.has(value), true);
assert.sameValue(set.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
