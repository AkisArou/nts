/*---
description: Control. Use an explicit toString call in the same interpolation of the no-write finding.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-closures, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-template-literals]
---*/
// Control: paired with tests/typescript/proofs-controls/element-kind-conversion-map-template-wide-integer-control.ts. Use an explicit toString call in the same interpolation of the no-write finding.
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
  assert.sameValue(`before:${operand.toString()}:after`, "before:tag:" + n + ":after");
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), 7);
}
