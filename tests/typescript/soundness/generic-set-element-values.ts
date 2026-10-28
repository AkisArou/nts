/*---
description: Explicit generic widening leaves a string in a numeric Set element through values iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-template-literals, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const seen: string[] = [];
for (const value of set.values()) {
  seen.push(`${typeof value}:${value}`);
}
assert.compareArray(seen, ["number:2", "string:7"]);
