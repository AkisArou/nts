/*---
description: A getter stores its initially empty parent into a structural leaf array.
features: [ts-lifetime-acyclic, ts-route-hook, ts-functions, ts-iteration, ts-class, ts-arrays, ts-accessors, ts-objects, ts-structural-typing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the implicit getter closes the cycle before publishing its parent; Node preserves the self-edge.
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

function build(n: number): Hub {
  const parent = new Hub(n);
  const source = { get value(): Hub { parent.children.push(parent); return parent; } };
  return source.value;
}
for (let n = 0; n < 240; n++) {
  const parent = build(n);
  churn(n);
  check(parent, n); assert.sameValue(parent.children.length, 1);
  assert.sameValue(parent.children[0] === parent, true);
}
