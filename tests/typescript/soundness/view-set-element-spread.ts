/*---
description: A readonly Set view preserves an aliased string element through a spread copy.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-spread, ts-readonly, ts-unsound-bivariance, ts-arrays]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const copy = [...set];
assert.sameValue(copy.length, 2);
assert.sameValue(typeof copy[1], "string");
assert.sameValue(JSON.stringify(copy), '[2,"7"]');
