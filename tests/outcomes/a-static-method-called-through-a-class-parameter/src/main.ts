// run: check
//
// Part of #867. The receiver parameter's declared type is typeof Base,
// but the static method must be selected from the class it actually holds.
// Kept separate from the local-value fixture because the JVM declines
// the Sub constructor's store into the parameter's signature layout.
// The Base-only control changes only the selected constructor, in
// a-static-method-called-through-a-class-parameter-control.

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
  const c: typeof Base = (n & 1) !== 0 ? Sub : Base;
  return throughParameter(c, n);
}
