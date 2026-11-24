// The control for `array-holds-subtype`: the same program, except that every
// slot holds a plain `Leaf`, so every object reaching `Leaf`'s typed release
// is a `Leaf` and every death in it is the typed one.

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

function weight(leaf: Leaf): number {
  return leaf instanceof Heavy ? leaf.value + leaf.note.size : leaf.value;
}

export function work(n: number): number {
  const leaves: Leaf[] = [];
  for (let i = 0; i < 4 + n; i++) {
    leaves.push(new Leaf(i));
    leaves.push(new Leaf(i + 1));
  }
  let total = 0;
  for (let i = 0; i < leaves.length; i++) {
    total = total + weight(leaves[i]);
  }
  return total;
}
