/*---
description: A recursive callback builds and retains a cycle behind structural leaf arrays.
features: [ts-lifetime-acyclic, ts-route-re-entry, ts-functions, ts-iteration, ts-class, ts-arrays, ts-closures, ts-structural-typing, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the callback re-enters the same allocation site; Node preserves the outer and nested parent identities.
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

function build(n: number, visit: (parent: Hub) => void): Hub {
  const parent = new Hub(n);
  visit(parent);
  return parent;
}
function pair(n: number): Hub {
  return build(n, outer => {
    const inner = build(n + 1, child => { child.children.push(outer); });
    outer.children.push(inner);
  });
}
for (let n = 0; n < 240; n++) {
  const outer = pair(n);
  churn(n);
  const inner = outer.children[0];
  if (!(inner instanceof Hub)) throw new Error("missing inner");
  check(outer, n); check(inner, n + 1);
  assert.sameValue(outer.children.length, 1); assert.sameValue(inner.children.length, 1);
  assert.sameValue(inner.children[0] === outer, true);
  assert.sameValue(outer.children[0] === inner, true);
}
