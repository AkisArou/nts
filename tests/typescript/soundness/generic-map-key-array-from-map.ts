/*---
description: Explicit generic widening leaves a string in a numeric Map key through Array.from's mapping callback.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>([[2, 20]]);
insert<unknown>(map, "7");
const copy = Array.from(map, (entry) => typeof entry[0] + ":" + String(entry[0] + 1));
assert.compareArray(copy, ["number:3", "string:71"]);
