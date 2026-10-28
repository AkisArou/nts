/*---
description: A readonly Map view preserves an aliased string key through an Array.from copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric key type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<number, number>([[2, 20]]);
const map: ReadonlyMap<number, number> = mutable;
const wider: Map<unknown, number> = mutable;
wider.set("7", 70);
const copied = Array.from(map);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][0], "string");
assert.sameValue(String(copied[1][0] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[[2,20],["7",70]]');
