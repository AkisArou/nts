/*---
description: A readonly Map view preserves an aliased string key through get and has lookups.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>();
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
// Recover the existing nominal-number key to exercise the narrow lookup API.
const [key] = map.keys();
assert.sameValue(typeof key, "string");
assert.sameValue(map.has(key), true);
assert.sameValue(map.get(key), 70);
assert.sameValue(map.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
assert.sameValue(String(key + 1), "71");
