// `ref(): this` — the polymorphic `this` return, which is how a fluent
// interface is spelled in TypeScript and which is everywhere in a stream API.
//
// TypeScript models it as a type parameter named after the class and
// constrained to it. Its *representation* is the receiver's, exactly: `this` in
// a method of `Counter` is a `Counter` pointer, and in a subclass it is a
// pointer to the subclass -- which under base-first layout is the same pointer.
// So this is not an approximation of the polymorphism, it is what the
// polymorphism costs at run time, which is nothing.
//
// What it took beyond the representation: a call whose result is used at a
// different type than the callee declares now carries a cast. `bump()` on the
// base returns a base pointer and a subclass caller's `this` is the subclass;
// the same pointer, and C wants telling, because
// `-Wincompatible-pointer-types` is an error in the emitted program.

class Counter {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
  bump(): this {
    this.n = this.n + 1;
    return this;
  }
  add(by: number): this {
    this.n = this.n + by;
    return this;
  }
}

export function chain(n: number): number {
  const c = new Counter(n);
  return c.bump().bump().add(5).n;
}

// A chain that ends in the receiver rather than a field, so the returned
// pointer is what the caller keeps.
export function returnsItself(n: number): number {
  const c = new Counter(n);
  const same = c.bump();
  same.bump();
  return c.n;
}

class Labelled extends Counter {
  tag: number;
  constructor(n: number) {
    super(n);
    this.tag = n * 2;
  }
  mark(): this {
    this.tag = this.tag + 1;
    return this;
  }
}

// The case that needs the cast: `bump()` is declared on the base and returns
// the base's pointer, but in a subclass `this` is the subclass -- so `.mark()`
// has to be reachable on what `bump()` handed back.
export function subclassChain(n: number): number {
  const l = new Labelled(n);
  return l.bump().mark().tag * 100 + l.n;
}

// Interleaved, so the chain crosses between base and subclass methods more
// than once.
export function interleaved(n: number): number {
  const l = new Labelled(n);
  return l.mark().bump().mark().add(3).tag * 1000 + l.n;
}

// An override that also returns `this`, reached through the base's declaration.
class Doubling extends Counter {
  bump(): this {
    this.n = this.n * 2;
    return this;
  }
}

export function overridden(n: number): number {
  const d = new Doubling(n);
  return d.bump().bump().n;
}

// The receiver kept in a variable of the *base* type, where the value is a
// subclass: dispatch decides which `bump` runs, and the result is used at the
// base's type.
export function throughTheBase(n: number): number {
  const c: Counter = new Doubling(n);
  return c.bump().add(1).n;
}
