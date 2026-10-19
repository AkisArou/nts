/*---
description: An async function awaits a recursive call of itself.
features: [ts-async, ts-functions]
flags: [async]
---*/
type Tree = { value: number; children: Tree[] };
async function sum(tree: Tree): Promise<number> {
  let total = tree.value;
  for (const child of tree.children) total += await sum(child);
  return total;
}
async function main(): Promise<void> {
  const tree: Tree = { value: 1, children: [{ value: 2, children: [{ value: 4, children: [] }] }, { value: 8, children: [] }] };
  assert.sameValue(await sum(tree), 15);
}
main().then(() => $DONE(), (error: unknown) => $DONE(error));
