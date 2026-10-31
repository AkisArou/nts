/*---
description: Control. Remove only the Map write from the conversion hook.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals]
---*/
// Control: paired with proofs/element-kind-conversion-map-template-wide-integer.ts. Remove only the Map write from the conversion hook.
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: toString runs inside interpolation; node preserves the wide entry for the subsequent values traversal.
function read(map: Map<string, number>): unknown {
  for (const value of map.values()) return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const operand = {
    toString(): string { return "tag:" + n; }
  };
  assert.sameValue(`before:${operand}:after`, "before:tag:" + n + ":after");
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), 7);
}
