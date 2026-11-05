/*---
description: "Logical OR distinguishes false and empty text from truthy members. Route: typed string boolean union"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-unions, ts-tuples]
---*/

// Logical OR distinguishes false and empty text from truthy members. Route: typed string boolean union. Node prints coalesce-or-string-boolean:ok.
type V = string | boolean | null | undefined;
function choose(value: V): V {
  const result = value || "other";
  return result;
}
const rows: readonly (readonly [V, V])[] = [[null, "other"], [undefined, "other"], ["", "other"], [false, "other"], ["ok", "ok"], [true, true]];
for (const [value, expected] of rows) assert.sameValue(choose(value), expected);
console.log("coalesce-or-string-boolean:ok");
