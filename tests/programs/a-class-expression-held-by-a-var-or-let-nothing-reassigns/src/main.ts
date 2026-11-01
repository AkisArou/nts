// A `var` or `let` initialized with a class expression, and written nowhere
// else, names that class as a `const` does: the binding holds nothing (see
// `lower_variable_statement`), and with no other write nothing else can run at
// `new C()`. Following only a `const` refused test262's `var C = class { … };
// new C()` -- 384 language cases that pass on main.
// Control: tests/programs/a-class-expression-held-by-a-const-beside-the-same-uses.
var C = class {
  constructor(readonly v: number) {}
  twice(): number {
    return this.v * 2;
  }
};
export function probe(n: number): number {
  let K = class {
    constructor(readonly v: number) {}
  };
  return new C(n).twice() + new K(n + 1).v;
}
