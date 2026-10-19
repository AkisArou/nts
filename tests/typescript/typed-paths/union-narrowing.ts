/*---
description: typeof narrows a union to each member's own operations.
features: [ts-unions, ts-narrowing]
---*/
function describe(value: number | string): string {
  if (typeof value === "number") return (value + 1).toString();
  return value.toUpperCase();
}
assert.sameValue(describe(41), "42");
assert.sameValue(describe("hi"), "HI");
