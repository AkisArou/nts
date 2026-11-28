// Control for `outcomes/a-generic-method-calling-a-generic-pins-the-bound-for-a-structural-argument`: `Other` extends `Box` and overrides `m`,
// so `call`'s copy at the bound dispatches to `Other#m` through the slot and
// agrees with node.

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

class Forward {
  outer<T extends Box>(r: T): number {
    return call(r) + 1;
  }
}

export function probe(n: number): number {
  return new Forward().outer(new Other(n & 7));
}
