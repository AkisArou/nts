/*---
description: Explicit generic widening leaves a string in a numeric Map key through a container copy constructor.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-generics, ts-destructuring, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>();
insert<unknown>(map, "7");
const copy = new Map(map);
const [key] = copy.keys();
assert.sameValue(copy.size, 1);
assert.sameValue(typeof key, "string");
assert.sameValue(copy.has(key), true);
assert.sameValue(copy.get(key), 70);
assert.sameValue(copy.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
