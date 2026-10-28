/*---
description: Explicit generic widening leaves a string in a numeric Map key through destructuring.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>();
insert<unknown>(map, "7");
const [[key, value]] = map;
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
assert.sameValue(value, 70);
