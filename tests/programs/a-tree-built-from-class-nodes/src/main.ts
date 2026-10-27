// The control for a-function-returning-a-recursive-array-type
// (tests/refusals): the same recursively built tree with class nodes
// instead of a recursive array alias. Agrees everywhere.

class Node {
  kids: Node[];
  constructor(kids: Node[]) {
    this.kids = kids;
  }
}

function build(depth: number): Node {
  if (depth === 1) return new Node([]);
  return new Node([build(depth - 1), build(depth - 1)]);
}

export function run(seed: number): number {
  const t = build(3);
  return t.kids.length + t.kids[0].kids.length + ((seed | 0) & 1);
}
