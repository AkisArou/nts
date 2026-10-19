/*---
description: `== null` narrows away both null and undefined; `=== null` only null.
features: [ts-unions, ts-narrowing, ts-null-undefined]
---*/
function loose(value: number | null | undefined): number {
  if (value == null) return -1;
  return value * 2;
}
function strict(value: number | null | undefined): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  return value.toFixed(0);
}
assert.sameValue(loose(null), -1);
assert.sameValue(loose(undefined), -1);
assert.sameValue(loose(0), 0);
assert.sameValue(strict(null) + strict(undefined) + strict(7), "nullundefined7");
