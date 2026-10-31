/*---
description: A module root closes an otherwise empty unknown edge back to its object.
features: [ts-lifetime-acyclic, ts-route-global, ts-functions, ts-iteration, ts-class, ts-unknown, ts-arrays, ts-modules]
flags: [module]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the module slot retains the object and supplies its self-edge; Node preserves that identity after churn.
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

let root: Cell | null = null;
function readRoot(): Cell | null { return root; }
function install(n: number): void {
  const value = new Cell(n);
  root = value;
  root.edge = root;
}
for (let n = 0; n < 240; n++) {
  install(n);
  churn(n);
  const value = readRoot();
  if (value === null) throw new Error("missing root");
  check(value, n);
  assert.sameValue(value.edge === value, true);
  assert.sameValue(root === value, true);
  root = null;
}
