// expect: which holds a class rather than naming one
//
// `function and constructor types` was ✅ and is ◐ as of 2026-09-14: the
// function half compiles and the constructor half is representable but cannot
// be used for the one thing it exists for.
//
// `type Maker = new (n: number) => Holder` type-checks. Constructing through a
// *value* of that type refuses -- the constructor would have to be chosen from
// the declared type rather than from the value.
//
// The control is the arrow beside it: a function type bound to an arrow and
// called compiles, so the refusal is about `new` through a value and not about
// type aliases for callables.
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
