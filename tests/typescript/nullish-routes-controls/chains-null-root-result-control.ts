/*---
description: "A null base returns undefined instead of null. Route: nullable interface parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// A null base returns undefined instead of null. Route: nullable interface parameter. Node prints chains-null-root-result:ok.
interface Leaf { value: number }
function read(base: Leaf | null): number | undefined {
  const saved = base; const result = saved === null || saved === undefined ? undefined : saved.value;
  return result;
}
assert.sameValue(read(null), undefined);
assert.sameValue(read({ value: 4 }), 4);
console.log("chains-null-root-result:ok");
