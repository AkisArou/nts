// run: check
//
// Control for #867: the receiver holds Base only. The declarations and
// calls match a-static-method-called-through-a-class-value; only each
// selected constructor changes. Both exports must agree with node.

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
  const c: typeof Base = Base;
  return c.make(n);
}

function throughParameter(c: typeof Base, n: number): number {
  return c.make(n);
}

export function parameter(n: number): number {
  const c: typeof Base = Base;
  return throughParameter(c, n);
}
