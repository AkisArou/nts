// `new` through a value typed with a construct signature runs the constructor
// its reference names. `const m: Maker = Holder` is a `const` alias of the
// class, so `new m(n)` runs `Holder`'s; it was refused while the constructor was
// chosen from the declared type rather than from the value. A value whose
// reference does not name the class -- a parameter, a `let` -- still refuses.
//
// The control is the arrow beside it: a function type bound to an arrow and
// called, which compiled throughout.
export class Holder {
  v: number;
  constructor(n: number) { this.v = n; }
}

type Maker = new (n: number) => Holder;
type Op = (a: number, b: number) => number;

export function control(n: number): number {
  const f: Op = (a, b) => a + b;
  return f(n, 1);
}

export function run(n: number): number {
  const m: Maker = Holder;
  return new m(n).v;
}
