// A tree built by a recursive builder, summed and dropped once a round.
//
// The tree-teardown shape. Every node of one round's tree dies before the next
// round builds another, so the memory report holds the tree for one arrival of
// the call that builds it (`hir::memory`'s interval), not for all of `work`.
// The control keeps each tree past its round.

class Tree {
  value: number;
  left: Tree | null;
  right: Tree | null;
  constructor(value: number, left: Tree | null, right: Tree | null) {
    this.value = value;
    this.left = left;
    this.right = right;
  }
}

function build(depth: number): Tree {
  if (depth === 0) return new Tree(1, null, null);
  return new Tree(depth, build(depth - 1), build(depth - 1));
}

function sum(tree: Tree): number {
  let total = tree.value;
  if (tree.left !== null) total = total + sum(tree.left);
  if (tree.right !== null) total = total + sum(tree.right);
  return total;
}

export function work(n: number): number {
  let total = 0;
  for (let round = 0; round < 4; round++) {
    const root = build(3 + (n & 1));
    total = total + sum(root);
  }
  return total;
}
