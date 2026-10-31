/*---
description: An async continuation closes the backedge of an initially one-way tree.
features: [ts-lifetime-acyclic, ts-route-await, ts-functions, ts-iteration, ts-class, ts-async, ts-arrays, ts-structural-typing, ts-narrowing]
flags: [async]
---*/
// Fact: acyclic types skip collection (docs/foundations/memory.md, Where nts stands).
// Route: locals span await before the child links back; Node preserves both nodes and both edges.
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

async function build(n: number): Promise<Hub> {
  const child = new Hub(n + 1);
  const parent = new Hub(n);
  parent.children.push(child);
  await Promise.resolve();
  child.children.push(parent);
  return parent;
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const parent = await build(n);
    churn(n);
    check(parent, n); assert.sameValue(parent.children.length, 1);
    const child = parent.children[0];
    if (!(child instanceof Hub)) throw new Error("missing child");
    check(child, n + 1); assert.sameValue(child.children.length, 1);
    assert.sameValue(child.children[0] === parent, true);
    assert.sameValue(parent.children[0] === child, true);
  }
}
run().then(() => $DONE(), error => $DONE(error));
