/*---
description: A Map stored in another Map is widened through its retrieved alias and given an undefined entry.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-destructuring, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the holder lookup returns the original Map; node distinguishes the newly stored undefined from a missing key.
function read(map: Map<string, number>): unknown { return map.get("added"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const holder = new Map<string, Map<string, unknown>>([["target", map]]);
  const alias = holder.get("target");
  if (alias !== undefined && n > 0) alias.set("added", undefined);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(read(map), undefined);
  assert.sameValue(map.has("added"), n > 0);
  assert.sameValue(map.size, n > 0 ? 2 : 1);
  assert.sameValue(map.get("item"), 7);
  let seen = 0;
  for (const [key, value] of map) if (key === "added") {
    seen++;
    assert.sameValue<unknown>(value, undefined);
  }
  assert.sameValue(seen, n > 0 ? 1 : 0);
}
