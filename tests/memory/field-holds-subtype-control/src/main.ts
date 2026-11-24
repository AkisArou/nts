// The control for `field-holds-subtype`: the same program, except that the
// right field holds a plain `Leaf`, so every object reaching `Leaf`'s typed
// release is a `Leaf` and every death in it is the typed one.

class Note {
  size: number;
  constructor(size: number) { this.size = size; }
}

class Leaf {
  value: number;
  constructor(value: number) { this.value = value; }
}

class Heavy extends Leaf {
  note: Note;
  constructor(value: number) {
    super(value);
    this.note = new Note(value + 1);
  }
}

class Pair {
  left: Leaf;
  right: Leaf;
  constructor(left: Leaf, right: Leaf) { this.left = left; this.right = right; }
}

function weight(leaf: Leaf): number {
  return leaf instanceof Heavy ? leaf.value + leaf.note.size : leaf.value;
}

export function work(n: number): number {
  const pairs: Pair[] = [];
  for (let i = 0; i < 4 + n; i++) {
    pairs.push(new Pair(new Leaf(i), new Leaf(i + 1)));
  }
  let total = 0;
  for (let i = 0; i < pairs.length; i++) {
    total = total + weight(pairs[i].left) + weight(pairs[i].right);
  }
  return total;
}
