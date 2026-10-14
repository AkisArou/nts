// A cycle through a tuple that a structural cast closes:
// Node -> pair ([Leaf, Node | null]) -> Node.
//
// A tuple of references is an array of its *first* element's type, so `pair`
// is a `Leaf[]` -- and a `Node` is stored in its second slot because `Node`
// holds `Leaf`'s field first. Following only subclasses, `Node` reached `Leaf`
// and nothing else, and every node leaked with its tuple and its leaf.

class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}

class Node {
  value: number;
  pair: [Leaf, Node | null];
  constructor() {
    this.value = 7;
    this.pair = [new Leaf(1), null];
  }
}

function link(n: Node): void {
  n.pair = [new Leaf(2), n];
}

export function work(count: number): number {
  let made = 0;
  for (let i = 0; i < 4 + count; i = i + 1) {
    const n = new Node();
    link(n);
    made = made + n.pair[0].value;
  }
  return made;
}
