/*---
description: A readonly Set view preserves an aliased string element through values iteration.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-iteration, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const seen: string[] = [];
for (const value of set.values()) {
  seen.push(`${typeof value}:${value}`);
}
assert.compareArray(seen, ["number:2", "string:7"]);
