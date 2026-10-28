/*---
description: Map get and has preserve a string key recovered through a number-keyed view.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-destructuring, ts-typeof-operator]
---*/
// TypeScript's method bivariance allows this wider map parameter to write a
// string into number-keyed storage. Node keeps the string's lookup identity.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>();
insert(map);
// Recover the existing nominal-number key to exercise the narrow lookup API.
const [key] = map.keys();
assert.sameValue(typeof key, "string");
assert.sameValue(map.has(key), true);
assert.sameValue(map.get(key), 70);
assert.sameValue(map.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
