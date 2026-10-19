/*---
description: A recursive generic type describes a tree that a generic function walks.
features: [ts-generics, ts-type-aliases]
---*/
type Tree<T> = { value: T; children: Tree<T>[] };
function flatten<T>(tree: Tree<T>): T[] {
  const out: T[] = [tree.value];
  for (const child of tree.children) out.push(...flatten(child));
  return out;
}
const tree: Tree<string> = {
  value: "a",
  children: [{ value: "b", children: [{ value: "c", children: [] }] }, { value: "d", children: [] }],
};
assert.sameValue(flatten(tree).join(""), "abcd");
const numbers: Tree<number> = { value: 1, children: [{ value: 2, children: [] }] };
assert.sameValue(flatten(numbers).reduce((a, b) => a + b, 0), 3);
