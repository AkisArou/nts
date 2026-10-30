/*---
description: A recursive call reaches a wide Map store after carrying the original container through several frames.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-destructuring]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the recursive base case stores above 32 bits; node retains the exact value in a later for-of read.
function write(map: Map<string, number>, remaining: number, seed: number): void {
  if (remaining <= 0) return;
  if (remaining === 1) map.set("item", 1099511627776 + seed);
  else write(map, remaining - 1, seed);
}
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map) if (key === "item") return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  write(map, n, n);
  return map;
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 1099511627776 + n : 7);
}
