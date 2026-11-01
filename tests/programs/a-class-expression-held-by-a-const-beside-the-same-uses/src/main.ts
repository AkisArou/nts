// Control for tests/programs/a-class-expression-held-by-a-var-or-let-nothing-reassigns:
// both bindings are `const`.
const C = class {
  constructor(readonly v: number) {}
  twice(): number {
    return this.v * 2;
  }
};
export function probe(n: number): number {
  const K = class {
    constructor(readonly v: number) {}
  };
  return new C(n).twice() + new K(n + 1).v;
}
