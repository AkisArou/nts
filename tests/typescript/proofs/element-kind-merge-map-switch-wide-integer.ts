/*---
description: A switch merge carries a wide integer Map value into Array.from observation.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the default switch arm writes above 32 bits; node preserves that value after the join.
function read(map: Map<string, number>): unknown { return Array.from(map.values())[0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  switch (n) {
    case -1: break;
    case 0: map.set("item", 7); break;
    default: map.set("item", 1099511627776 + n); break;
  }
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 1099511627776 + n : 7);
}
