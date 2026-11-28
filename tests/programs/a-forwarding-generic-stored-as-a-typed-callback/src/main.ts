// A generic that forwards its own type parameter, stored as a typed callback.
// `f` holds `outer` at `(b: Box) => number`, so `probe` calls the copy the
// value-context instantiation makes (`outer<value-obj…>`), which names
// `call`'s copy at `outer`'s own argument and agrees with node.
//
// That instantiation also makes `outer`'s erased fallback, which forwards `T`
// as `erased`. `call<erased>` has no method table for `r.m()`, so it refuses
// by name, and the fallback refuses behind it: the row in
// tooling/gate/example-refusals. Before #896 the fallback named `call`'s copy
// at the bound and handed it an `erased` value where it laid out a `Box`, with
// no check, and nothing was refused. No case reaches the fallback. A change to
// the erased fallback is measured against this count.
//
// Control: `a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument-control`
// calls `outer` directly, not through a callback, and refuses nothing.

class Box {
  m(): number {
    return 1;
  }
}

class Sub extends Box {
  readonly n: number;
  constructor(n: number) {
    super();
    this.n = n;
  }
  override m(): number {
    return this.n * 10;
  }
}

function call<T extends Box>(r: T): number {
  return r.m();
}

function outer<T extends Box>(r: T): number {
  return call(r) + 1;
}

const f: (b: Box) => number = outer;

export function probe(n: number): number {
  return f(new Sub(n & 7));
}
