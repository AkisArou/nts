/*---
description: A relational conversion stores undefined into an otherwise numeric Map.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-this, ts-closures, ts-conversions, ts-to-primitive, ts-expressions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the left operand valueOf overwrites item; node preserves the present undefined entry after evaluating the comparison.
function read(map: Map<string, number>): unknown { return Array.from(map)[0][1]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  class Operand {
    active: boolean;
    numeric: number;
    constructor(active: boolean, numeric: number) { this.active = active; this.numeric = numeric; }
    valueOf(): number {
      if (this.active && n > 0) writable.set("item", undefined);
      return this.numeric;
    }
  }
  assert.sameValue(new Operand(true, n) < new Operand(false, 2), n < 2);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(read(map), n > 0 ? undefined : 7);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.size, 1);
  assert.sameValue(map.has("missing"), false);
}
