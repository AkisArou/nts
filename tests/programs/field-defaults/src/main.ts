// Field initializers, which run at construction.
//
// `new Counter().value` read `0` for as long as this compiler has existed. The
// allocation is zeroed and the initializer was never emitted at all, and no
// example caught it because a zeroed field and an initialized one are the same
// bytes whenever the initializer *is* the zero value — the only field
// initializer in the whole corpus was `code: string = ""`.
//
// So every value here is deliberately not zero.

class Counter {
  value: number = 5;
  step: number = 2;
}

export function fromDefaults(n: number): number {
  const c = new Counter();
  return c.value + c.step + n;
}

// A constructor assigns the same field. Source order says the constructor
// wins, so the initializer runs first and is overwritten.
class Seeded {
  value: number = 5;

  constructor(v: number) {
    this.value = v;
  }
}

export function constructorWins(n: number): number {
  return new Seeded(n).value;
}

// A field the constructor does *not* touch keeps its initializer, in the same
// class as one it does.
class Partly {
  assigned: number = 1;
  untouched: number = 9;

  constructor(v: number) {
    this.assigned = v;
  }
}

export function onlyOneIsAssigned(n: number): number {
  const p = new Partly(n);
  return p.assigned + p.untouched;
}

// Inherited. The base's initializer runs for a derived instance too, which is
// why the walk goes base-first.
class Base {
  base: number = 3;
}

class Derived extends Base {
  own: number = 4;
}

export function inherited(n: number): number {
  const d = new Derived();
  return d.base + d.own + n;
}
