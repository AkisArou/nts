/*---
description: A joined branch preserves a fractional Map store at the common reader.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: one branch writes a fraction and the other preserves the integer; node observes the joined value through values iteration.
function read(map: Map<string, number>): unknown {
  for (const value of map.values()) return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  if (n > 0) map.set("item", n / 4);
  else map.set("item", 7);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? n / 4 : 7);
  assert.sameValue(typeof value, "number");
}
