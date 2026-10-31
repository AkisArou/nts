/*---
description: A conversion hook closes a cycle through a captured object and its unknown field.
features: [ts-lifetime-acyclic, ts-route-hook, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-to-string, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: toString stores its receiver into the captured object; Node preserves the receiver and captured value.
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

class Label {
  value: Cell;
  constructor(value: Cell) { this.value = value; }
  toString(): string { this.value.edge = this; return this.value.text; }
}
function build(n: number): Cell {
  const value = new Cell(n);
  const label = new Label(value);
  assert.sameValue("" + label, "cell:" + n);
  return value;
}
for (let n = 0; n < 240; n++) {
  const value = build(n);
  churn(n);
  check(value, n);
  const label = value.edge;
  if (!(label instanceof Label)) throw new Error("missing label");
  assert.sameValue(label.value === value, true);
  assert.sameValue(value.edge === label, true);
}
