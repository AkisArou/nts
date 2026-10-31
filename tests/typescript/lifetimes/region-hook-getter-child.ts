/*---
description: An implicit getter retains a leaf after the region result last use.
features: [ts-lifetime-region, ts-route-hook, ts-functions, ts-objects, ts-strings, ts-accessors, ts-arrays, ts-closures]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: reading the getter stores the captured result leaf for later observation. Node preserves the retained value after the result dies.
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
function keep(n: number): Cell[] {
  const root = build(n);
  const saved: Cell[] = [];
  const hook = { get value(): number {
    saved.push(root.left, root.right);
    return root.left.value;
  } };
  assert.sameValue(hook.value, n * 3 + 7);
  return saved;
}
for (let n = 0; n < 240; n++) {
  const saved = keep(n);
  churn(n);
  assert.sameValue(saved.length, 2);
  check(saved[0], saved[1], n);
}
