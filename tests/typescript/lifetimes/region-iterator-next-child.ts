/*---
description: Iterator next results retain a child after its region result and iterator die.
features: [ts-lifetime-region, ts-route-iterator, ts-functions, ts-objects, ts-strings, ts-iteration, ts-arrays, ts-tuples]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: next hands out two references from a result-local array. Node preserves the retained value after the result dies.
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
function keep(n: number): [Cell, Cell] {
  const root = build(n);
  const iterator = [root.left, root.right].values();
  const first = iterator.next();
  const second = iterator.next();
  if (first.done || second.done) throw new Test262Error("short iterator");
  return [first.value, second.value];
}
for (let n = 0; n < 240; n++) {
  const saved = keep(n);
  churn(n);
  check(saved[0], saved[1], n);
}
