// A cycle that only a structural cast can close: Node -> kids (Leaf[]) -> Node.
//
// `Node` holds `Leaf`'s one field first, so a `Node` is admitted where a `Leaf`
// is wanted, by pointer cast -- and `add(n, n)` is specialized into a copy
// whose `kid` already *is* a `Node`, so nothing in the program marks the cast.
// Reachability that followed only subclasses saw `Node -> Leaf[] -> Leaf` and
// called `Node` acyclic, and these cycles were found only while `n.kids`
// happened to be retained around the `push`. Elide that pair -- which
// `field-array-mutation` exists to do -- and every node leaked.

class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

class Node {
  value: number;
  kids: Leaf[];
  constructor() {
    this.value = 7;
    this.kids = [];
  }
}

function add(n: Node, kid: Leaf): void {
  n.kids.push(kid);
}

export function work(count: number): number {
  let made = 0;
  for (let i = 0; i < 4 + count; i = i + 1) {
    const n = new Node();
    add(n, n);
    made = made + n.kids.length;
  }
  return made;
}
