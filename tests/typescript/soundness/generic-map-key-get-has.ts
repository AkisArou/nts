/*---
description: Explicit generic widening leaves a string in a numeric Map key through get and has lookups.
features: [ts-unsound-generic-widening, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-generics, ts-functions]
---*/
// TypeScript admits the numeric container at an explicit unknown instantiation
// through method bivariance. The write breaks its type; node keeps the string.
function insert<T>(map: Map<T, number>, key: T): void {
  map.set(key, 70);
}
const map = new Map<number, number>();
insert<unknown>(map, "7");
// Recover the existing nominal-number key to exercise the narrow lookup API.
const [key] = map.keys();
assert.sameValue(typeof key, "string");
assert.sameValue(map.has(key), true);
assert.sameValue(map.get(key), 70);
assert.sameValue(map.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
