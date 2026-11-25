// run: check
//
// Part of #867. The checker resolves the call to Base.make, but the
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

