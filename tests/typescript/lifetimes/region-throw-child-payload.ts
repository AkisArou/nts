/*---
description: A thrown payload retains a child after unwinding its region result.
features: [ts-lifetime-region, ts-route-throw, ts-functions, ts-objects, ts-strings, ts-errors, ts-class, ts-class-fields, ts-instanceof, ts-narrowing]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: the thrown value carries both leaf references out of the builder scope. Node preserves the retained value after the result dies.
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
class Payload {
  value: Cell;
  identity: Cell;
  constructor(value: Cell, identity: Cell) { this.value = value; this.identity = identity; }
}
function raise(n: number): never {
  const root = build(n);
  throw new Payload(root.left, root.right);
}
for (let n = 0; n < 240; n++) {
  let saved: Payload | undefined;
  try { raise(n); } catch (error) {
    if (!(error instanceof Payload)) throw error;
    saved = error;
  }
  if (saved === undefined) throw new Test262Error("no payload");
  churn(n);
  check(saved.value, saved.identity, n);
}
