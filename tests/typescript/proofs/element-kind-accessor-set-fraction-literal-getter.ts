/*---
description: A literal getter inserts a fraction before a separate Set reader runs.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-accessors, ts-objects, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: reading the getter invokes its conditional fractional Set insertion.
function read(items: Set<number>): number {
  const values = Array.from(items);
  return values[values.length - 1];
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const gate = {
    get token(): number { if (n > 0) items.add(n + 0.5); return n + 10; }
  };
  assert.sameValue(gate.token, n + 10);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
