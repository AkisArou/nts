/*---
description: The Map copy constructor preserves a string key under a number key type.
features: [ts-unsound-bivariance, ts-map-set, ts-iteration, ts-destructuring, ts-typeof-operator]
---*/
// TypeScript's method bivariance permits inserting a string through the wider
// map. Node's Map constructor preserves its identity when copying the map.
function insert(map: Map<unknown, number>): void {
  map.set("7", 70);
}
const map = new Map<number, number>();
insert(map);
const copy = new Map(map);
const [key] = copy.keys();
assert.sameValue(copy.size, 1);
assert.sameValue(typeof key, "string");
assert.sameValue(copy.has(key), true);
assert.sameValue(copy.get(key), 70);
assert.sameValue(copy.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
