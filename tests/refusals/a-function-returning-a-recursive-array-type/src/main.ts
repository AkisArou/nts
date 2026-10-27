// expect: a function returning a recursive array type
//
// Reduced from AWFY Storage (2026-10-27): `type ArrayTree = ArrayTree[]`
// built recursively and returned. A recursive array alias has no finite
// layout to return by, and lowering refuses the function and its call
// results. The same tree as class nodes is the control:
// a-tree-built-from-class-nodes.

type ArrayTree = ArrayTree[];

function build(depth: number): ArrayTree {
  if (depth === 1) return new Array(2);
  const arr: ArrayTree = new Array(2);
  for (let i = 0; i < 2; i++) arr[i] = build(depth - 1);
  return arr;
}

export function run(seed: number): number {
  const t = build(3);
  return t.length + t[0].length + ((seed | 0) & 1);
}
