/*---
description: Explicit generic widening leaves a string in a numeric Map value through values iteration.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const seen: string[] = [];
for (const value of map.values()) {
  seen.push(typeof value + ":" + String(value + 1));
}
assert.compareArray(seen, ["number:3", "string:71"]);
