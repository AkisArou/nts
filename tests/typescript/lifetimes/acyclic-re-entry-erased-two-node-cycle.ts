/*---
description: Re-entering a builder through its callback closes two initially empty unknown edges.
features: [ts-lifetime-acyclic, ts-route-re-entry, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-closures, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the callback calls the builder again while the first object is live; Node preserves both cross-links.
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

function build(n: number, visit: (value: Cell) => void): Cell {
  const value = new Cell(n);
  visit(value);
  return value;
}
function pair(n: number): Cell {
  return build(n, outer => {
    const inner = build(n + 1, child => { child.edge = outer; });
    outer.edge = inner;
  });
}
for (let n = 0; n < 240; n++) {
  const outer = pair(n);
  churn(n);
  const inner = outer.edge;
  if (!(inner instanceof Cell)) throw new Error("missing inner");
  check(outer, n); check(inner, n + 1);
  assert.sameValue(inner.edge === outer, true);
  assert.sameValue(outer.edge === inner, true);
}
