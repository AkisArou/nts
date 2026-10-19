/*---
description: A type parameter constrained to a union is narrowed by typeof inside the generic function.
features: [ts-generics, ts-generic-constraints, ts-unions, ts-narrowing]
---*/
function describe<T extends number | string>(value: T): string {
  if (typeof value === "number") return `n:${value.toFixed(1)}`;
  return `s:${value.length}`;
}
function both<T extends number | string>(values: T[]): string {
  return values.map(describe).join(" ");
}
assert.sameValue(describe(3), "n:3.0");
assert.sameValue(describe("four"), "s:4");
assert.sameValue(both<number | string>([1, "ab", 2.25]), "n:1.0 s:2 n:2.3");
