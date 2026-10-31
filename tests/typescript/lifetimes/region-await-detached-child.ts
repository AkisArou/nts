/*---
description: A detached result child survives in an async frame while other regions churn.
features: [ts-lifetime-region, ts-route-await, ts-functions, ts-objects, ts-strings, ts-async]
flags: [async]
---*/
// Fact: result-contained allocations may share a region (docs/foundations/memory.md, The ladder of homes).
// Route: await suspends after the root last use but before either leaf read. Node preserves the retained value after the result dies.
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
async function observe(n: number): Promise<void> {
  const root = build(n);
  const child = root.left;
  const identity = root.right;
  await Promise.resolve();
  check(child, identity, n);
}
async function run(): Promise<void> {
  for (let n = 0; n < 240; n++) {
    const pending = observe(n);
    churn(n);
    await pending;
  }
}
run().then(() => $DONE(), $DONE);
