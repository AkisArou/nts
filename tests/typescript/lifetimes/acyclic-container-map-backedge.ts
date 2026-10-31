/*---
description: A map entry and an unknown object field close a two-object cycle.
features: [ts-lifetime-acyclic, ts-route-container, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-map-set]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: a Map retains its value and the value retains the Map; Node follows both directions after churn.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
class Cell {
  id: number; text: string; edge: unknown = null;
  constructor(n: number) { this.id = n; this.text = "cell:" + n; }
}
function check(value: Cell, n: number): void {
  assert.sameValue(value.id, n); assert.sameValue(value.text, "cell:" + n);
  assert.sameValue(value.text.length, ("cell:" + n).length);
}
function churn(n: number): void {
  const all: Cell[] = [];
  for (let i = 0; i < 24; i++) all.push(new Cell(n + i + 1000));
  for (let i = 0; i < all.length; i++) { check(all[i], n + i + 1000); assert.sameValue(all[i].edge, null); }
}

function build(n: number): Map<number, Cell> {
  const value = new Cell(n);
  const table = new Map<number, Cell>();
  table.set(n, value);
  value.edge = table;
  return table;
}
for (let n = 0; n < 240; n++) {
  const table = build(n);
  churn(n);
  assert.sameValue(table.size, 1);
  const value = table.get(n);
  if (value === undefined) throw new Error("missing value");
  check(value, n);
  assert.sameValue(value.edge === table, true);
  assert.sameValue(table.get(n) === value, true);
}
