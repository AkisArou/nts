/*---
description: "A Map lookup retains numeric falsy values. Route: Map string-key lookup (control)"
features: [ts-nullish-routes, ts-nullish-route-coalesce, ts-null-undefined, ts-map, ts-numbers]
---*/

// A Map lookup retains numeric falsy values. Route: Map string-key lookup. Node prints coalesce-map-get:ok.
const map = new Map<string, number>([["zero", 0], ["negative", -0], ["nan", NaN], ["live", 4]]);
function read(key: string): number {
  const saved = map.get(key); const result = saved === null || saved === undefined ? 9 : saved;
  return result;
}
for (const [key, expected] of [["zero", 0], ["negative", -0], ["nan", NaN], ["absent", 9], ["live", 4]] as const) {
  assert.sameValue(read(key), expected);
}
console.log("coalesce-map-get:ok");
