// run: check
//
// The method form of outcomes/a-generic-calling-a-generic-pins-the-bound-for-a-structural-argument
// (#896): a generic *method* forwards its own type parameter to a generic
// function, and the argument matches the bound only structurally. In
// `Forward#outer`'s copy for `T = Other` the call must name `call<Other>`, the
// copy a direct `call(new Other(...))` names, not `call<Box>`: node answers
// (n & 7) * 10 + 1, and the bound's copy runs `Box#m` and answers 2.
//
// The control is programs/a-generic-method-calling-a-generic-pins-the-bound-for-a-structural-argument-control,
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

class Forward {
  outer<T extends Box>(r: T): number {
    return call(r) + 1;
  }
}

export function probe(n: number): number {
  return new Forward().outer(new Other(n & 7));
}
