// `a-tree-builder-site-is-proved` with one difference: each round's tree is
// also kept in an array that outlives the round.
//
// The rounds' trees now overlap, and the array holds them for the whole of
// `work`, so no tree is held for one arrival of the call that builds it.

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
  const kept: Tree[] = [];
  let total = 0;
  for (let round = 0; round < 4; round++) {
    const root = build(3 + (n & 1));
    total = total + sum(root);
    kept.push(root);
  }
  return total;
}
