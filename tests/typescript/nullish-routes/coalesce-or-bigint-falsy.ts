/*---
description: "Logical OR replaces zero bigint while keeping negative bigint. Route: Map returning bigint"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-map-set]
---*/

// Logical OR replaces zero bigint while keeping negative bigint. Route: Map returning bigint. Node prints coalesce-or-bigint-falsy:ok.
const values = new Map<string, bigint>([["zero", 0n], ["negative", -2n]]);
function select(key: string): bigint {
  const result = values.get(key) || 3n;
  return result;
}
assert.sameValue(select("zero"), 3n);
assert.sameValue(select("negative"), -2n);
assert.sameValue(select("missing"), 3n);
console.log("coalesce-or-bigint-falsy:ok");
