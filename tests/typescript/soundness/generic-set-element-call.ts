/*---
description: Explicit generic widening leaves a string in a numeric Set element through a numeric parameter.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const set = new Set<number>();
insert<unknown>(set, "7");
const [value] = set;
assert.sameValue(describe(value), "string:71");
