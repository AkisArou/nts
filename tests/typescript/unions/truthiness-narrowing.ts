/*---
description: A truthiness check removes undefined and null but also the falsy members of a union.
features: [ts-unions, ts-narrowing, ts-null-undefined]
---*/
function describe(value: string | number | undefined | null): string {
  if (value) return `truthy ${value}`;
  return `falsy ${String(value)}`;
}
assert.sameValue(describe("a"), "truthy a");
assert.sameValue(describe(""), "falsy ");
assert.sameValue(describe(0), "falsy 0");
assert.sameValue(describe(Number.NaN), "falsy NaN");
assert.sameValue(describe(undefined), "falsy undefined");
assert.sameValue(describe(null), "falsy null");
