/*---
description: A nested called writer widens an integral Map value to a fraction.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the two-level call reaches the fractional store; node reads it through Array.from on the original Map.
function write(map: Map<string, number>, n: number): void {
  if (n > 0) map.set("item", n + 0.5);
}
function outer(map: Map<string, number>, n: number): void { write(map, n); }
function read(map: Map<string, number>): unknown { return Array.from(map.values())[0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  outer(map, n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? n + 0.5 : 7);
}
