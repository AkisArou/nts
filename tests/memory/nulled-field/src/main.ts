// Nulling out a reference field, which leaked it.
//
// The store branch was guarded on whether the *new* value needed counting, and
// a constant null does not -- so `x.f = null` skipped the load and release of
// what `x.f` was holding, and the old value was never given back. In every
// program, under naive counting too.
//
// `awfy-towers` ends `popDiskFrom` with `top.next = null` and leaked a disk on
// every one of its 8191 moves. Nothing caught it: the answers were right,
// because a leaked list computes the same sum, and no example in the corpus
// nulls a field and then looks.

class Link {
  value: number;
  next: Link | null;
  constructor(v: number) {
    this.value = v;
    this.next = null;
  }
}

export function work(n: number): number {
  const head = new Link(0);
  let total = 0;
  for (let i = 0; i < 16 + n; i = i + 1) {
    // A fresh link, hung off `head`, and then cut loose again. Nothing else
    // holds it, so cutting it loose is what has to free it.
    const made = new Link(i);
    head.next = made;
    total = total + made.value;
    head.next = null;
  }
  return total;
}
