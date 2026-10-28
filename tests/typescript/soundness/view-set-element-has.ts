/*---
description: A readonly Set view preserves an aliased string element through a has lookup.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>();
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
// Recover the existing nominal-number member to call the narrow has method.
const [value] = set;
assert.sameValue(typeof value, "string");
assert.sameValue(set.has(value), true);
assert.sameValue(set.has(7), false);
const identities = new Map<unknown, string>([["7", "string"], [7, "number"]]);
assert.sameValue(identities.get(value), "string");
assert.sameValue(String(value + 1), "71");
