/*---
description: A readonly Set view preserves an aliased string element through a forEach callback.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Set alias by method bivariance while
// this ReadonlySet retains a numeric element type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Set<number>([2]);
const set: ReadonlySet<number> = mutable;
const wider: Set<unknown> = mutable;
wider.add("7");
const seen: string[] = [];
set.forEach((value, key, owner) => {
  assert.sameValue(owner, set);
  seen.push(`${typeof value}:${value + 1}/${typeof key}:${key + 1}`);
});
assert.compareArray(seen, ["number:3/number:3", "string:71/string:71"]);
