/*---
description: Closures keep a child alive after its region result is dropped.
features: [ts-lifetime-region, ts-route-closure, ts-functions, ts-objects, ts-strings, ts-closures, ts-tuples]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: two delayed closures capture the same leaf, not its old root. Node preserves the retained value after the result dies.
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
function keep(n: number): [() => Cell, () => Cell] {
  const root = build(n);
  const child = root.left;
  const identity = root.right;
  return [() => child, () => identity];
}
for (let n = 0; n < 240; n++) {
  const readers = keep(n);
  churn(n);
  check(readers[0](), readers[1](), n);
}
