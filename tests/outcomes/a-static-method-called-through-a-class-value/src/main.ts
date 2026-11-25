// run: check
//
// Part of #867. The checker resolves both calls to Base.make, but the
// receiver can hold Sub. Static method lookup must follow that value.
// The Base-only control changes only the selected constructor, in
// a-static-method-called-through-a-class-value-control.

class Base {
  static make(n: number): number {
    return n + 100;
  }
}

class Sub extends Base {
  static override make(n: number): number {
    return n + 200;
  }
}

export function conditional(n: number): number {
  const c: typeof Base = (n & 1) !== 0 ? Sub : Base;
  return c.make(n);
}

function throughParameter(c: typeof Base, n: number): number {
  return c.make(n);
}

export function parameter(n: number): number {
  const c: typeof Base = (n & 1) !== 0 ? Sub : Base;
  return throughParameter(c, n);
}
