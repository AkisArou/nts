// run: check
//
// Control for #867: the parameter receives Base only. The declarations
// and call match a-static-method-called-through-a-class-parameter;
// only the selected constructor changes. This export agrees with node.

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

function throughParameter(c: typeof Base, n: number): number {
  return c.make(n);
}

export function parameter(n: number): number {
  const c: typeof Base = Base;
  return throughParameter(c, n);
}
