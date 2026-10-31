/*---
description: A structural leaf hides a closure that points back to its parent.
features: [ts-lifetime-acyclic, ts-route-closure, ts-functions, ts-iteration, ts-class, ts-closures, ts-arrays, ts-structural-typing, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: a captured parent is stored behind a leaf view; Node follows the child reader to the same parent.
// Node checks live edges; unreachable cycles are left intact for the steady-heap check.
type Face = { id: number; text: string };
class Hub {
  id: number; text: string; children: Face[] = [];
  constructor(n: number) { this.id = n; this.text = "hub:" + n; }
}
function check(value: Hub, n: number): void {
  assert.sameValue(value.id, n); assert.sameValue(value.text, "hub:" + n);
  assert.sameValue(value.text.length, ("hub:" + n).length);
}
function churn(n: number): void {
  const all: Hub[] = [];
  for (let i = 0; i < 24; i++) all.push(new Hub(n + i + 1000));
  for (let i = 0; i < all.length; i++) { check(all[i], n + i + 1000); assert.sameValue(all[i].children.length, 0); }
}

class Leaf {
  id: number; text: string; read: () => Face;
  constructor(n: number, read: () => Face) { this.id = n; this.text = "leaf:" + n; this.read = read; }
}
function build(n: number): () => Hub {
  const parent = new Hub(n);
  const read = (): Hub => parent;
  parent.children.push(new Leaf(n + 1, read));
  return read;
}
for (let n = 0; n < 240; n++) {
  const read = build(n);
  churn(n);
  const parent = read();
  check(parent, n); assert.sameValue(parent.children.length, 1);
  const child = parent.children[0];
  if (!(child instanceof Leaf)) throw new Error("missing leaf");
  assert.sameValue(child.id, n + 1); assert.sameValue(child.text, "leaf:" + (n + 1));
  assert.sameValue(child.text.length, ("leaf:" + (n + 1)).length);
  assert.sameValue(child.read() === parent, true);
  assert.sameValue(read() === parent, true);
}
