/*---
description: A readonly Set view preserves an aliased string element through Array.from's mapping callback.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-arrays, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const seen = Array.from(set, (value: number) => typeof value + ":" + String(value + 1));
assert.compareArray(seen, ["number:3", "string:71"]);
