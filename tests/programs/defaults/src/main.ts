// A parameter default is filled in at the calls that omit it, which is where
// JavaScript evaluates it: in the callee's scope, after the arguments that were
// provided. So there is no test in the callee and no cost at run time -- the
// value arrives as an ordinary argument.

const STEP = 3;

function add(a: number, b: number = 2): number {
  return a + b;
}

// A default is an expression, not a literal: this one folds, and `label`'s does
// not fold at all.
function scale(n: number, by: number = STEP * 2): number {
  return n * by;
}

function label(s: string = "abc"): string {
  return s;
}

class Counter {
  n: number;
  constructor(start: number = 10) {
    this.n = start;
  }
  bump(by: number = STEP): number {
    this.n = this.n + by;
    return this.n;
  }
}

// A derived class whose `super()` supplies the base's default.
class Tens extends Counter {
  constructor() {
    super();
  }
}

export function omitted(n: number): number {
  return add(n) + scale(n);
}

export function supplied(n: number): number {
  return add(n, 5) + scale(n, 1);
}

// The same function reached both ways in one expression, so a default that
// leaked into the supplied call would show up as a difference.
export function both(n: number): number {
  return add(n) + add(n, 0);
}

export function throughAMethod(n: number): number {
  const c = new Counter();
  return c.bump() + c.bump(n);
}

export function throughAConstructor(n: number): number {
  return new Counter(n).n + new Counter().n;
}

export function throughSuper(): number {
  return new Tens().n;
}

export function aStringDefault(n: number): number {
  return label().length + label("wxyz").length + n;
}
