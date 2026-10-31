/*---
description: Re-entry cannot reset a caller region while its detached child remains live.
features: [ts-lifetime-region, ts-route-re-entry, ts-functions, ts-objects, ts-strings, ts-closures, ts-function-types]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: the callback re-enters the same reader and builder before the outer read. Node preserves the retained value after the result dies.
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
function observe(n: number, enter: () => void): void {
  const root = build(n);
  const child = root.left;
  const identity = root.right;
  enter();
  check(child, identity, n);
}
for (let n = 0; n < 240; n++) {
  observe(n, () => {
    observe(n + 256, () => { churn(n + 256); });
    churn(n);
  });
}
