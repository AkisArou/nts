/*---
description: A class setter inserts a wide integer into the Set held in its declared field.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-accessors, ts-class, ts-class-fields, ts-this]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: assignment invokes the class setter, which adds through its Set field.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}

class Gate {
  items: Set<number>;
  constructor(items: Set<number>) { this.items = items; }
  set amount(n: number) { if (n > 0) this.items.add(4294967296 + n); }
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const gate = new Gate(items);
  gate.amount = n;
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
