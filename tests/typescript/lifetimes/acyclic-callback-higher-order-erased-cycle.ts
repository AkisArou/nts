/*---
description: A higher-order callback closes an unknown self-edge before retaining its value.
features: [ts-lifetime-acyclic, ts-route-callback, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-function-types]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the program callback publishes the object after making its self-edge; Node preserves that cycle.
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

function accept(value: Cell, save: (value: Cell) => Cell): Cell { return save(value); }
function build(n: number): Cell {
  const value = new Cell(n);
  return accept(value, item => { item.edge = item; return item; });
}
for (let n = 0; n < 240; n++) {
  const value = build(n);
  churn(n);
  check(value, n);
  assert.sameValue(value.edge === value, true);
}
