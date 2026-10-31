/*---
description: Static fields retain a child beyond the result that originally owned it.
features: [ts-lifetime-region, ts-route-global, ts-functions, ts-objects, ts-strings, ts-class, ts-class-fields, ts-static]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: the leaf is published into two static fields before its root is dropped. Node preserves the retained value after the result dies.
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
class Saved {
  static value: Cell | undefined;
  static identity: Cell | undefined;
}
function publish(n: number): void {
  const root = build(n);
  Saved.value = root.left;
  Saved.identity = root.right;
}
for (let n = 0; n < 240; n++) {
  publish(n);
  churn(n);
  const value = Saved.value;
  const identity = Saved.identity;
  if (value === undefined || identity === undefined) throw new Test262Error("missing leaf");
  check(value, identity, n);
  Saved.value = undefined;
  Saved.identity = undefined;
}
