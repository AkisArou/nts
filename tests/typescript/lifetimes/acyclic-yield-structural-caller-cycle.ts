/*---
description: A yielded parent becomes a two-node structural cycle before resumption.
features: [ts-lifetime-acyclic, ts-route-yield, ts-functions, ts-iteration, ts-class, ts-arrays, ts-generators, ts-structural-typing]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: the suspended local is linked through leaf views; Node resumes with both backedges intact.
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

function* hold(n: number): Generator<Hub, Hub, unknown> {
  const parent = new Hub(n);
  yield parent;
  return parent;
}
for (let n = 0; n < 240; n++) {
  const reader = hold(n);
  const first = reader.next();
  if (first.done) throw new Error("missing yield");
  const child = new Hub(n + 1);
  first.value.children.push(child); child.children.push(first.value);
  churn(n);
  const done = reader.next();
  if (!done.done) throw new Error("not complete");
  assert.sameValue(done.value === first.value, true);
  check(done.value, n); check(child, n + 1);
  assert.sameValue(done.value.children.length, 1); assert.sameValue(child.children.length, 1);
  assert.sameValue(done.value.children[0] === child, true);
  assert.sameValue(child.children[0] === done.value, true);
}
