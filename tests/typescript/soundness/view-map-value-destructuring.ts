/*---
description: A readonly Map view preserves an aliased string value through destructuring.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>();
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const [[key, value]] = map;
assert.sameValue(key, "value");
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
