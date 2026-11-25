// run: check
//
// Control for #867: the receiver holds Base only. The declarations and
// call match a-static-method-called-through-a-class-value; only the
// selected constructor changes. This export must agree with node.

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

