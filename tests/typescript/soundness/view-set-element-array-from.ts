/*---
description: A readonly Set view preserves an aliased string element through an Array.from copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const copied: number[] = Array.from(set);
assert.sameValue(copied.length, 2);
assert.sameValue(typeof copied[1], "string");
assert.sameValue(String(copied[1] + 1), "71");
assert.sameValue(JSON.stringify(copied), '[2,"7"]');
