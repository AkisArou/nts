/*---
description: "Nullable options coalescing correctly reads property-null. Route: nullable interface options field (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined, ts-optional-chaining]
---*/

// Nullable options coalescing correctly reads property-null. Route: nullable interface options field. Node prints defaults-options-property-null:ok.
interface Options { retries?: number | null }
function read(options?: Options | null): number {
  const base = options; const saved = base === null || base === undefined ? undefined : base.retries; const result = saved === null || saved === undefined ? 3 : saved;
  return result;
}
assert.sameValue(read({ retries: null }), 3);
console.log("defaults-options-property-null:ok");
