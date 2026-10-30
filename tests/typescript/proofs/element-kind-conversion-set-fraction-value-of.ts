/*---
description: Number conversion invokes a valueOf hook that inserts a fractional Set entry.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-spread, ts-conversions, ts-to-primitive, ts-objects, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: Number invokes user valueOf between numeric initialization and the Set read.
function read(items: Set<number>): number {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const gate = {
    valueOf(): number { if (n > 0) items.add(n + 0.5); return 7; }
  };
  assert.sameValue(Number(gate), 7);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
