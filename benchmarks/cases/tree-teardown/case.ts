// Sixteen complete binary trees (511 nodes each) per unit of work. The root
// dies after the checksum walk; native RC tears down every node individually.
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

function build(depth: number, value: number): Tree {
  if (depth === 0) return new Tree(value, null, null);
  return new Tree(value, build(depth - 1, (value + 1) | 0),
    build(depth - 1, (value + 3) | 0));
}

function sum(tree: Tree): number {
  let total = tree.value;
  if (tree.left !== null) total = (total + sum(tree.left)) | 0;
  if (tree.right !== null) total = (total + sum(tree.right)) | 0;
  return total;
}

export function work(n: number): number {
  n = (n & 3) + 1;
  let total = 0;
  for (let round = 0; round < 16 * n; round++) {
    const root = build(8, round | 0);
    total = (total + sum(root)) | 0;
  }
  return total;
}

export const seed = 0;
