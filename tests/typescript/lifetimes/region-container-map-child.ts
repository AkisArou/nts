/*---
description: Map values retain the identity of a leaf detached from a region result.
features: [ts-lifetime-region, ts-route-container, ts-functions, ts-objects, ts-strings, ts-map-set]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: two Map entries outlive the result that first held their leaf. Node preserves the retained value after the result dies.
type Cell = { id: number; value: number; text: string };
type Tree = { left: Cell; right: Cell };
function build(n: number): Tree {
  const leaf = { id: n, value: n * 3 + 7, text: "leaf:" + n };
  return { left: leaf, right: leaf };
}
function churn(n: number): void {
  for (let i = 0; i < 8; i++) {
    const tree = build(n + 512 + i);
    assert.sameValue(tree.left.value + tree.right.id, (n + 512 + i) * 4 + 7);
  }
}
function check(value: Cell, identity: Cell, n: number): void {
  assert.sameValue(value === identity, true);
  assert.sameValue(value.id, n);
  assert.sameValue(value.value, n * 3 + 7);
  assert.sameValue(value.text, "leaf:" + n);
  assert.sameValue(value.text.length, ("leaf:" + n).length);
}
function fill(n: number, saved: Map<number, Cell>): void {
  const root = build(n);
  saved.set(0, root.left);
  saved.set(1, root.right);
}
for (let n = 0; n < 240; n++) {
  const saved = new Map<number, Cell>();
  fill(n, saved);
  churn(n);
  const value = saved.get(0);
  const identity = saved.get(1);
  if (value === undefined || identity === undefined) throw new Test262Error("missing entry");
  assert.sameValue(saved.size, 2);
  check(value, identity, n);
  saved.clear();
}
