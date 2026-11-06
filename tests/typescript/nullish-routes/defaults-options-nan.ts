/*---
description: "Nullable options coalescing correctly reads nan. Route: nullable interface options field"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined, ts-optional-chaining]
---*/

// Nullable options coalescing correctly reads nan. Route: nullable interface options field. Node prints defaults-options-nan:ok.
interface Options { retries?: number | null }
function read(options?: Options | null): number {
  const result = options?.retries ?? 3;
  return result;
}
assert.sameValue(read({ retries: NaN }), NaN);
console.log("defaults-options-nan:ok");
