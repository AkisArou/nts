/*---
description: A captured object points back to its reader through an unknown field.
features: [ts-lifetime-acyclic, ts-route-closure, ts-functions, ts-iteration, ts-class, ts-unknown, ts-closures, ts-arrays]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: a stored closure captures the object and closes its edge; Node follows the cycle after the builder returns.
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

class Reader { read: () => Cell; constructor(read: () => Cell) { this.read = read; } }
function build(n: number): Reader {
  const value = new Cell(n);
  const reader = new Reader(() => value);
  value.edge = reader;
  return reader;
}
for (let n = 0; n < 240; n++) {
  const reader = build(n);
  churn(n);
  const value = reader.read();
  check(value, n);
  assert.sameValue(value.edge === reader, true);
  assert.sameValue(reader.read() === value, true);
}
