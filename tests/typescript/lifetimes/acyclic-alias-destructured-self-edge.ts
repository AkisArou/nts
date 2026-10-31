/*---
description: A destructured alias keeps a cyclic object after its first name is dropped.
features: [ts-lifetime-acyclic, ts-route-alias, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-destructuring, ts-objects]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: destructuring retains the source and supplies its unknown backedge; Node preserves the remaining alias.
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

for (let n = 0; n < 240; n++) {
  let value: Cell | null = new Cell(n);
  const { alias } = { alias: value };
  value.edge = alias;
  value = null;
  churn(n);
  check(alias, n);
  assert.sameValue(alias.edge === alias, true);
}
