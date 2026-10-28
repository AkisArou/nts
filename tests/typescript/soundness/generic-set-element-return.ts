/*---
description: Explicit generic widening leaves a string in a numeric Set element through a numeric return.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
function first(set: Set<number>): number {
  const [value] = set;
  return value;
}
const set = new Set<number>();
insert<unknown>(set, "7");
const value: number = first(set);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
