/*---
description: A readonly Map view preserves an aliased string key through Array.from's mapping callback.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>([[2, 20]]);
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const copy = Array.from(map, (entry) => typeof entry[0] + ":" + String(entry[0] + 1));
assert.compareArray(copy, ["number:3", "string:71"]);
