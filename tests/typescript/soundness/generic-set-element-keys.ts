/*---
description: Explicit generic widening leaves a string in a numeric Set element through keys iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const seen: string[] = [];
for (const key of set.keys()) {
  seen.push(typeof key + ":" + String(key + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
