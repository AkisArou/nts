// What an array of references costs the cycle collector, which is a candidate
// per release that does not reach zero -- and none of them can be in a cycle.
//
// `cyclic` is decided per *type*: an object of type `T` can be in a cycle only
// if `T` is reachable from `T` through reference fields. `Leaf` holds a number
// and `HoldsOne` holds a `Leaf`, so neither ever can, and releasing one above
// zero buffers nothing.
//
// `Leaf[]` cannot either -- an array of `Leaf` reaches a `Leaf` reaches a
// number -- but every array of references shares one descriptor, which
// describes the element's *shape* and not what the element points at. So the
// answer is unknown, unknown has to mean yes, and the same release buffers a
// candidate.
//
// The two halves below are the same reachability written twice. The store over
// a field is what makes each release land above zero, deterministically,
// rather than depending on the order the frame gives things up.

class Leaf {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
}

class HoldsOne {
  item: Leaf;
  constructor(x: Leaf) {
    this.item = x;
  }
}

class HoldsMany {
  items: Leaf[];
  constructor(x: Leaf[]) {
    this.items = x;
  }
}

export function work(n: number): number {
  const first = new Leaf(1 + n);
  const second = new Leaf(2 + n);

  // Releases `first` while the local still holds it: 2 -> 1, above zero, and
  // `HoldsOne`'s element type is not cyclic.
  const one = new HoldsOne(first);
  one.item = second;

  const listA: Leaf[] = [first];
  const listB: Leaf[] = [second];

  // The same shape, and the same release: 2 -> 1, above zero. This one is
  // buffered.
  const many = new HoldsMany(listA);
  many.items = listB;

  return one.item.value + many.items.length + listA.length + first.value;
}
