/*---
description: Explicit generic widening leaves a string in a numeric Map key through an Array.from copy.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>([[2, 20]]);
insert<unknown>(map, "7");
const copied = Array.from(map);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][0], "string");
assert.sameValue(String(copied[1][0] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[[2,20],["7",70]]');
