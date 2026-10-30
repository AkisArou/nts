/*---
description: Reading an object getter stores a fraction into an initially integral Map.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-accessors, ts-objects, ts-closures]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the getter performs the widening write; node retains its fractional value when the original Map is read elsewhere.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const gate = {
    get ticket(): number { if (n > 0) map.set("item", n / 4); return 9; }
  };
  assert.sameValue(gate.ticket, 9);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? n / 4 : 7);
}
