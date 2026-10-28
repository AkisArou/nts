/*---
description: A readonly Map view preserves an aliased string key through the Map copy constructor.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance, ts-destructuring]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>();
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const copy = new Map(map);
const [key] = copy.keys();
assert.sameValue(copy.size, 1);
assert.sameValue(typeof key, "string");
assert.sameValue(copy.has(key), true);
assert.sameValue(copy.get(key), 70);
assert.sameValue(copy.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(key), "string");
assert.sameValue(String(key + 1), "71");
