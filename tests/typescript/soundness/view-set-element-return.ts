/*---
description: A readonly Set view preserves an aliased string element through a numeric return.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-destructuring, ts-functions, ts-readonly, ts-unsound-bivariance]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
function first(set: ReadonlySet<number>): number {
  const [value] = set;
  return value;
}
const mutable = new Set<number>();
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const value: number = first(set);
assert.sameValue(typeof value, "string");
assert.sameValue(String(value + 1), "71");
