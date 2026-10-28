/*---
description: A readonly Map view preserves an aliased string value through an Array.from copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>([["control", 2]]);
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const copy = Array.from(map);
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1][1], "string");
assert.sameValue(JSON.stringify(copy), '[["control",2],["value","7"]]');
