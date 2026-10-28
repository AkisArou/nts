/*---
description: Explicit generic widening leaves a string in a numeric Map key through entries iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-tuples, ts-generics, ts-template-literals, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>([[2, 20]]);
insert<unknown>(map, "7");
const seen: string[] = [];
for (const entry of map.entries()) {
  seen.push(`${typeof entry[0]}:${entry[0]}:${entry[1]}`);
}
assert.compareArray(seen, ["number:2:20", "string:7:70"]);
