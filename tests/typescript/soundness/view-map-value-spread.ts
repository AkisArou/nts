/*---
description: A readonly Map view preserves an aliased string value through a spread copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-readonly, ts-unsound-bivariance, ts-arrays]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>([["control", 2]]);
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const copied = [...map];
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1][1], "string");
assert.sameValue(String(copied[1][1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[["control",2],["value","7"]]');
