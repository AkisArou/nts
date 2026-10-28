/*---
description: A readonly Map view preserves an aliased string value through a forEach callback.
features: [ts-unsound-covariant-view, ts-map-set, ts-typeof-operator, ts-conversions, ts-functions, ts-readonly, ts-unsound-bivariance, ts-template-literals]
---*/
// TypeScript accepts a widened mutable Map alias by method bivariance while
// this ReadonlyMap retains a numeric value type. Node reads the stored
// string through that readonly view without changing its identity.
const mutable = new Map<string, number>([["control", 2]]);
const map: ReadonlyMap<string, number> = mutable;
const wider: Map<string, unknown> = mutable;
wider.set("value", "7");
const seen: string[] = [];
map.forEach((value, key, owner) => {
  assert.sameValue(owner, map);
  seen.push(`${key}:${typeof value}:${value + 1}`);
});
assert.compareArray(seen, ["control:number:3", "value:string:71"]);
