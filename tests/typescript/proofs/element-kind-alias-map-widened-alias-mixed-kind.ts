/*---
description: A widened field alias stores a string that remains a string through the original numeric Map view.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-typeof-operator, ts-strings]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the unknown-valued alias writes the entry; node keeps its runtime string in Array.from of the original Map.
function read(map: Map<string, number>): unknown { return Array.from(map)[0][1]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const holder: { map: Map<string, unknown> } = { map };
  const alias = holder.map;
  if (n > 0) alias.set("item", "alias:" + n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? "alias:" + n : 7);
  assert.sameValue(typeof value, n > 0 ? "string" : "number");
}
