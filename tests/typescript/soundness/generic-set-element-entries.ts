/*---
description: Explicit generic widening leaves a string in a numeric Set element through entries iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-generics, ts-template-literals, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(set: Set<T>, value: T): void {
  set.add(value);
}
const set = new Set<number>([2]);
insert<unknown>(set, "7");
const seen: string[] = [];
for (const entry of set.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0] + 1}/${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
