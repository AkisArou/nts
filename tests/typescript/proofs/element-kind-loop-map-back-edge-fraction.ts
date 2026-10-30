/*---
description: A second loop visit stores a fraction in a previously integral Map.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the back edge reaches the fractional store; node reads that fraction through the original Map in a separate function.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(turns: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  for (let i = 0; i < turns; i++) {
    if (i === 1) map.set("item", turns + 0.25);
  }
  return map;
}
for (const n of [0, 1, 2, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 1 ? n + 0.25 : 7);
  assert.sameValue(typeof value, "number");
}
