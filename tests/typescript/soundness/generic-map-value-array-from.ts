/*---
description: Explicit generic widening leaves a string in a numeric Map value through an Array.from copy.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const copy = Array.from(map);
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][1], "string");
assert.sameValue(JSON.stringify(copy), '[["control",2],["value","7"]]');
