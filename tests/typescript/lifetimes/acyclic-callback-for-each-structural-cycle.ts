/*---
description: A forEach callback stores the parent through a reference-free leaf view.
features: [ts-lifetime-acyclic, ts-route-callback, ts-functions, ts-iteration, ts-class, ts-arrays, ts-closures, ts-structural-typing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: forEach closes and retains the structural cycle; Node preserves the callback result and backedge.
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

function build(n: number): Hub[] {
  const parent = new Hub(n);
  const saved: Hub[] = [];
  [parent].forEach(value => { value.children.push(value); saved.push(value); });
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = build(n);
  churn(n);
  assert.sameValue(saved.length, 1);
  const parent = saved[0];
  check(parent, n); assert.sameValue(parent.children.length, 1);
  assert.sameValue(parent.children[0] === saved[0], true);
}
