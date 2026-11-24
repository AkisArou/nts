// An array typed `Leaf[]` that holds a `Heavy`, a subclass with a reference
// of its own. `Leaf` is proved acyclic and so is the array, so the array's
// descriptor releases each slot through `Leaf`'s release specialized by type.
// That release compares the slot's descriptor before it assumes the layout,
// and hands a `Heavy` to the runtime's release, which gives up its `note`.
// Taking the element type as the layout would leak every `Note`.
//
// The control (`array-holds-subtype-control`) puts a plain `Leaf` where the
// `Heavy` is.

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
    leaves.push(new Heavy(i));
  }
  let total = 0;
  for (let i = 0; i < leaves.length; i++) {
    total = total + weight(leaves[i]);
  }
  return total;
}
