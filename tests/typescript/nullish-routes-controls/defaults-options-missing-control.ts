/*---
description: "Nullable options coalescing correctly reads missing. Route: nullable interface options field (control)"
features: [ts-nullish-routes, ts-nullish-route-defaults, ts-null-undefined, ts-optional-chaining]
---*/

// Nullable options coalescing correctly reads missing. Route: nullable interface options field. Node prints defaults-options-missing:ok.
interface Options { retries?: number | null }
function read(options?: Options | null): number {
  const base = options; const saved = base === null || base === undefined ? undefined : base.retries; const result = saved === null || saved === undefined ? 3 : saved;
  return result;
}
assert.sameValue(read(), 3);
console.log("defaults-options-missing:ok");
