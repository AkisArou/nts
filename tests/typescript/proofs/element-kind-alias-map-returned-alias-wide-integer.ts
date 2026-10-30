/*---
description: A returned alias widens a Map entry beyond 32 bits before the original view is traversed.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-destructuring]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the returned Map alias performs the wide store; node observes the same entry through for-of.
function identity(map: Map<string, number>): Map<string, number> { return map; }
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map.entries()) if (key === "item") return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const alias = identity(map);
  if (n > 0) alias.set("item", 4294967296 + n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 4294967296 + n : 7);
}
