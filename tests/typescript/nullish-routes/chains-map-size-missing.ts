/*---
description: "An unsuccessful Map get skips a Set size read. Route: Map of Set values"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// An unsuccessful Map get skips a Set size read. Route: Map of Set values. Node prints chains-map-size-missing:ok.
const values = new Map<string, Set<number>>([["empty", new Set()], ["full", new Set([1,2])]]);
function size(key: string): number | undefined {
  const result = values.get(key)?.size;
  return result;
}
assert.sameValue(size("missing"), undefined);
assert.sameValue(size("empty"), 0);
assert.sameValue(size("full"), 2);
console.log("chains-map-size-missing:ok");
