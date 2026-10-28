/*---
description: Explicit generic widening leaves a string in a numeric Map value through Array.from's mapping callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const seen = Array.from(map, (entry) => typeof entry[1] + ":" + String(entry[1] + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
