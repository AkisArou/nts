// A field and an array slot typed `Leaf` that hold a `Heavy`, a subclass with
// references of its own, released through `Leaf`'s release specialized by type.
// That release compares the object's descriptor before it assumes the layout,
// so a `Heavy` goes to the runtime's release and gives up its note and its
// tags. Under `--rc` and `NTS_POISON` a `Heavy` freed as a `Leaf` would leave
// its note's count above zero and a tag string held; the answer would still
// agree, so `tests/memory/field-holds-subtype` is what counts the leak. This
// one holds the answer to node's across every backend, including a `Heavy`
// whose note is shared, so its typed release decrements rather than frees.

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
  tag: string;
  constructor(value: number, note: Note) {
    super(value);
    this.note = note;
    this.tag = "heavy-" + value;
  }
}

class Pair {
  left: Leaf;
  right: Leaf;
  constructor(left: Leaf, right: Leaf) { this.left = left; this.right = right; }
}

function weight(leaf: Leaf): number {
  return leaf instanceof Heavy ? leaf.value + leaf.note.size + leaf.tag.length : leaf.value;
}

const shared = new Note(100);
let total = 0;
for (let round = 0; round < 50; round++) {
  const pairs: Pair[] = [];
  const leaves: Leaf[] = [];
  for (let i = 0; i < 64; i++) {
    const note = i % 3 === 0 ? shared : new Note(i);
    pairs.push(new Pair(new Leaf(i), new Heavy(i, note)));
    leaves.push(new Heavy(i + round, note));
    leaves.push(new Leaf(round));
  }
  for (let i = 0; i < pairs.length; i++) {
    total = (total + weight(pairs[i].left) + weight(pairs[i].right)) | 0;
  }
  for (let i = 0; i < leaves.length; i++) {
    total = (total + weight(leaves[i])) | 0;
  }
}
console.log(total, shared.size);
