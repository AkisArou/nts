/*---
description: "Optional method access on zero bigint does not short circuit. Route: bigint or null function parameter (control)"
features: [ts-nullish-routes, ts-nullish-route-chains, ts-null-undefined, ts-optional-chaining]
---*/

// Optional method access on zero bigint does not short circuit. Route: bigint or null function parameter. Node prints chains-zero-bigint-string:ok.
function show(input: bigint | null): string | undefined {
  const saved = input; const result = saved === null || saved === undefined ? undefined : saved.toString();
  return result;
}
assert.sameValue(show(0n), "0");
assert.sameValue(show(5n), "5");
assert.sameValue(show(null), undefined);
console.log("chains-zero-bigint-string:ok");
