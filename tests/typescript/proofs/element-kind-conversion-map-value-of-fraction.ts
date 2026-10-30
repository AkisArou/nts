/*---
description: Numeric conversion invokes valueOf and widens a Map entry to a fraction.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-closures, ts-conversions, ts-to-primitive]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: unary plus runs valueOf before the later reader; node observes both the conversion result and the fractional Map value.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const operand = {
    valueOf(): number { if (n > 0) map.set("item", n + 0.5); return n; }
  };
  assert.sameValue(+operand, n);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? n + 0.5 : 7);
}
