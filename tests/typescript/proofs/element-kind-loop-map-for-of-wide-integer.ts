/*---
description: A live Map entry loop replaces an integer value with a value above 32 bits.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-destructuring]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: a for-of visit overwrites its current entry; node retains the wide value in a later entry traversal.
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map) if (key === "item") return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7], ["control", 2]]);
  let visits = 0;
  for (const [key] of map) {
    visits++;
    if (key === "item" && n > 0) map.set(key, 4294967296 + n);
  }
  assert.sameValue(visits, 2);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(read(map), n > 0 ? 4294967296 + n : 7);
  assert.sameValue(map.get("control"), 2);
}
