// Control for `outcomes/a-generic-class-calling-a-generic-pins-the-bound-for-a-structural-argument`: `Other` extends `Box` and overrides `m`,
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

class Holder<T extends Box> {
  readonly r: T;
  constructor(r: T) {
    this.r = r;
  }
  run(): number {
    return call(this.r) + 1;
  }
}

export function probe(n: number): number {
  return new Holder(new Other(n & 7)).run();
}
