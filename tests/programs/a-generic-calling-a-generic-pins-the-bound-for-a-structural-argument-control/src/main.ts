// Control for `outcomes/a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument`:
// `Other` extends `Box` and overrides `m`, so `call`'s copy at the bound, which
// `outer`'s copy names, dispatches to `Other#m` through the slot and agrees with
// node.

class Box {
  m(): number {
    return 1;
  }
}

class Other extends Box {
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

export function probe(n: number): number {
  return outer(new Other(n & 7));
}
