/*---
description: A readonly Set view preserves an aliased string element through a numeric parameter.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
function describe(value: number): string {
  return typeof value + ":" + String(value + 1);
}
const mutable = new Set<number>();
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const [value] = set;
assert.sameValue(describe(value), "string:71");
