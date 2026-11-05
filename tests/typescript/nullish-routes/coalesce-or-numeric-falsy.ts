/*---
description: "Logical OR replaces negative zero, NaN and numeric zero. Route: nullable number parameter"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-numbers, ts-functions]
---*/

// Logical OR replaces negative zero, NaN and numeric zero. Route: nullable number parameter. Node prints coalesce-or-numeric-falsy:ok.
function select(value: number | null | undefined): number {
  const result = value || 2;
  return result;
}
for (const [value, expected] of [[null, 2], [undefined, 2], [-0, 2], [0, 2], [NaN, 2], [3, 3], [-5, -5]] as const) {
  assert.sameValue(select(value), expected);
}
console.log("coalesce-or-numeric-falsy:ok");
