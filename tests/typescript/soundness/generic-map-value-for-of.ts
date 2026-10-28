/*---
description: Explicit generic widening leaves a string in a numeric Map value through for-of iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-template-literals, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const seen: string[] = [];
for (const entry of map) {
  seen.push(`${typeof entry[1]}:${entry[1] + 1}`);
}
assert.compareArray(seen, ["number:3", "string:71"]);
