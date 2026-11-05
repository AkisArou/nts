/*---
description: "Coalescing preserves all six falsy non-nullish primitives. Route: typed interface union rows (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-unions, ts-interfaces]
---*/

// Coalescing preserves all six falsy non-nullish primitives. Route: typed interface union rows. Node prints coalesce-union-falsy-rows:ok.
type Value = number | string | boolean | bigint | null | undefined;
interface Holder { item: Value }
const rows: readonly (readonly [Value, Value])[] = [[null, 17], [undefined, 17], [0, 0], [-0, -0], [NaN, NaN], ["", ""], [false, false], [0n, 0n], [7, 7]];
for (const [value, expected] of rows) {
  const holder: Holder = { item: value };
  const saved = holder.item; const result = saved === null || saved === undefined ? 17 : saved;
  assert.sameValue(result, expected);
  assert.sameValue(holder.item, value);
}
console.log("coalesce-union-falsy-rows:ok");
