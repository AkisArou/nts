/*---
description: Explicit generic widening leaves a string in a numeric Map value through a spread copy.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-generics, ts-arrays, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<string, T>, value: T): void {
  map.set("value", value);
}
const map = new Map<string, number>([["control", 2]]);
insert<unknown>(map, "7");
const copied = [...map];
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][1], "string");
assert.sameValue(String(copied[1][1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[["control",2],["value","7"]]');
