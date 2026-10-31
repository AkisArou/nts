/*---
description: A default parameter hides a self-edge behind a reference-free structural view.
features: [ts-lifetime-acyclic, ts-route-alias, ts-functions, ts-iteration, ts-class, ts-arrays, ts-default-parameters, ts-structural-typing, ts-narrowing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the default alias is retained after the original name changes; Node keeps the old parent and edge.
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

function close(parent: Hub, alias: Face = parent): Face {
  parent.children.push(alias);
  return alias;
}
for (let n = 0; n < 240; n++) {
  let parent = new Hub(n);
  const saved = close(parent);
  parent = new Hub(n + 1000);
  churn(n);
  if (!(saved instanceof Hub)) throw new Error("lost parent");
  check(saved, n); assert.sameValue(saved.children.length, 1);
  assert.sameValue(saved.children[0] === saved, true);
  assert.sameValue(saved === parent, false);
  check(parent, n + 1000); assert.sameValue(parent.children.length, 0);
}
