/*---
description: An outer array retains a leaf from a dead region result.
features: [ts-lifetime-region, ts-route-container, ts-functions, ts-objects, ts-strings, ts-arrays]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: two array elements hold the extracted leaf after the builder scope ends. Node preserves the retained value after the result dies.
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
function fill(n: number, saved: Cell[]): void {
  const root = build(n);
  saved.push(root.left, root.right);
}
for (let n = 0; n < 240; n++) {
  const saved: Cell[] = [];
  fill(n, saved);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
  saved.length = 0;
}
