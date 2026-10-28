/*---
description: Explicit generic widening leaves a string in a numeric Set element through a container copy constructor.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-template-literals, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const copy = new Set(set);
const seen: string[] = [];
for (const value of copy) {
  seen.push(`${typeof value}:${value + 1}`);
  assert.sameValue(copy.has(value), true);
}
assert.sameValue(copy.has(7), false);
assert.compareArray(seen, ["number:3", "string:71"]);
