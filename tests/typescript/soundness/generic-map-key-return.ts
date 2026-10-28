/*---
description: Explicit generic widening leaves a string in a numeric Map key through a numeric return.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-generics]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
function firstKey(map: Map<number, number>): number {
  const [key] = map.keys();
  return key;
}
const map = new Map<number, number>();
insert<unknown>(map, "7");
const key: number = firstKey(map);
assert.sameValue(typeof key, "string");
assert.sameValue(String(key + 1), "71");
