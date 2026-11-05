/*---
description: "An optional chain indexes a present tuple without widening its values. Route: nullable typed tuple (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// An optional chain indexes a present tuple without widening its values. Route: nullable typed tuple. Node prints chains-optional-tuple-index:ok.
function pick(tuple: [number, string?] | null): number | string | undefined {
  const saved = tuple; const result = saved === null || saved === undefined ? undefined : saved[0];
  return result;
}
assert.sameValue(pick(null), undefined);
assert.sameValue(pick([7]), 7);
assert.sameValue(pick([-0, "a"]), -0);
console.log("chains-optional-tuple-index:ok");
