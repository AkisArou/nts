// A field typed `Leaf` that holds a `Heavy`, a subclass with a reference of
// its own. `Pair` and `Leaf` are proved acyclic, so each has a release
// specialized by type, and `Pair`'s gives its fields up through `Leaf`'s.
// The static type is only a lower bound on the layout: `Leaf`'s typed release
// compares the object's descriptor first, and hands a `Heavy` to the
// runtime's release, which gives up its `note`. Taking the static type as the
// layout would free a `Heavy` as a `Leaf` and leak every `Note`.
//
// The control (`field-holds-subtype-control`) is the same program with a
// plain `Leaf` in the right field.

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
    pairs.push(new Pair(new Leaf(i), new Heavy(i)));
  }
  let total = 0;
  for (let i = 0; i < pairs.length; i++) {
    total = total + weight(pairs[i].left) + weight(pairs[i].right);
  }
  return total;
}
