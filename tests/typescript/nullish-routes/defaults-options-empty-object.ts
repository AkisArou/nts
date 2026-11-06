/*---
description: "Nullable options coalescing correctly reads empty-object. Route: nullable interface options field"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined, ts-optional-chaining]
---*/

// Nullable options coalescing correctly reads empty-object. Route: nullable interface options field. Node prints defaults-options-empty-object:ok.
interface Options { retries?: number | null }
function read(options?: Options | null): number {
  const result = options?.retries ?? 3;
  return result;
}
assert.sameValue(read({}), 3);
console.log("defaults-options-empty-object:ok");
