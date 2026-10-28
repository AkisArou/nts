/*---
description: A readonly Map view preserves an aliased string key through a spread copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-readonly, ts-unsound-bivariance, ts-arrays]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>([[2, 20]]);
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const copy = [...map];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][0], "string");
assert.sameValue(JSON.stringify(copy), '[[2,20],["7",70]]');
