/*---
description: An object-field alias stores a fraction into a Map read through its original variable.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-spread, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the aliased field writes the same Map; node preserves the fractional value through a spread reader.
function read(map: Map<string, number>): unknown { return [...map.values()][0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const holder = { contents: map };
  const alias = holder;
  if (n > 0) alias.contents.set("item", n / 4);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? n / 4 : 7);
  assert.sameValue(typeof value, "number");
}
