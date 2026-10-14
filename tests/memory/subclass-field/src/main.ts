// One slot, two types.
//
// `Derived` shares `Base`'s layout with its own fields after, so `d.left` and
// `b.left` are the same eight bytes while the IR calls them different types.
// Telling slots apart by type would decide that the store cannot disturb the
// load, elide the retain, and free `got` while it is still named -- which is
// why `field_name` compares names and never types.
//
// The read of `got.tag` is what makes that visible: it is a load out of memory
// the program would have freed, so the answer changes rather than the count.

class Base {
  tag: number;
  left: Base | null;
  constructor(t: number) { this.tag = t; this.left = null; }
}

class Derived extends Base {
  extra: number;
  constructor(t: number, e: number) { super(t); this.extra = e; }
}

export function work(n: number): number {
  let total = 0;
  for (let i = 0; i < 16 + n; i++) {
    const d = new Derived(i, i + 1);
    d.left = new Base(7);
    const b: Base = d;
    const got = b.left;
    d.left = new Base(9);
    total = total + (got === null ? 0 : got.tag) + d.extra;
  }
  return total;
}
