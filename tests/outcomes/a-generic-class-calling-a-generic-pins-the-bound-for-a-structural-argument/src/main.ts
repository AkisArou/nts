// run: check
//
// The class form of outcomes/a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument
// (#896): a method of a generic *class* forwards the class's type parameter to
// a generic function, and the class is instantiated with an argument that
// matches the bound only structurally. In `Holder<Other>`'s copy the call must
// name `call<Other>`, not `call<Box>`: node answers (n & 7) * 10 + 1, and the
// bound's copy runs `Box#m` and answers 2.
//
// The control is programs/a-generic-class-calling-a-generic-pins-the-bound-for-a-structural-argument-control,
// and it differs in one thing: `Other` extends `Box` and overrides `m`.

class Box {
  m(): number {
    return 1;
  }
}

class Other {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  m(): number {
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
