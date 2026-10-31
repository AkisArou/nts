/*---
description: A static root makes a structural backedge invisible to a nominal leaf type.
features: [ts-lifetime-acyclic, ts-route-global, ts-functions, ts-iteration, ts-class, ts-static, ts-arrays, ts-structural-typing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the static slot supplies a parent as its own leaf; Node sees the same object through both roots.
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

class Roots { static value: Hub | null = null; }
function install(n: number): void {
  const parent = new Hub(n);
  Roots.value = parent;
  Roots.value.children.push(Roots.value);
}
for (let n = 0; n < 240; n++) {
  install(n);
  churn(n);
  const parent = Roots.value;
  if (parent === null) throw new Error("missing root");
  check(parent, n);
  assert.sameValue(parent.children.length, 1);
  assert.sameValue(parent.children[0] === parent, true);
  assert.sameValue(Roots.value === parent, true);
  Roots.value = null;
}
