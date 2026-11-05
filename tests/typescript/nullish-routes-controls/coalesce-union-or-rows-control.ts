/*---
description: "Logical OR replaces every falsy union value. Route: typed interface union rows (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-unions, ts-interfaces]
---*/

// Logical OR replaces every falsy union value. Route: typed interface union rows. Node prints coalesce-union-or-rows:ok.
type Value = number | string | boolean | bigint | null | undefined;
interface Holder { item: Value }
const rows: readonly (readonly [Value, Value])[] = [[null, 17], [undefined, 17], [0, 17], [-0, 17], [NaN, 17], ["", 17], [false, 17], [0n, 17], [7, 7]];
for (const [value, expected] of rows) {
  const holder: Holder = { item: value };
  const saved = holder.item; const result = saved ? saved : 17;
  assert.sameValue(result, expected);
}
console.log("coalesce-union-or-rows:ok");
