/*---
description: Assigning a setter writes a value above 32 bits into a numeric Map.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-accessors, ts-closures]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the setter widens the Map entry; node preserves the exact 2^40 offset in Array.from of the original values.
function read(map: Map<string, number>): unknown { return Array.from(map.values())[0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  class Gate {
    set input(value: number) { if (value > 0) map.set("item", 1099511627776 + value); }
  }
  const gate = new Gate();
  gate.input = n;
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 1099511627776 + n : 7);
}
