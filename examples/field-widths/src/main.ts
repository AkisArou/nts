// A field that depends on its own value.
//
// `hir::fields` narrows a field every store puts a small whole number into, and
// it could not narrow one whose stores *read the field*. The interprocedural
// fixpoint started with no facts for any field, an absent entry reads as TOP at
// the use, and so `this.x += this.step` computed TOP in round one, published
// TOP, and every round after agreed.
//
// `Ball` in Are We Fast Yet is four such fields, and the row is worth 1.58x to
// 1.45x of hand-written C++ — measured before and after on one machine, with
// `awfy-nbody` and `awfy-queens` unmoved, which is what says the lever is
// self-reference rather than fields in general.
//
// The half this file is really for is the fields that must *not* narrow. A
// fixpoint that starts too low is unsound in a way that starting too high is
// not: the answers change, and they change quietly.

class Counter {
  // Every store is a small whole number, and one of them reads the field.
  total: number;
  step: number;

  constructor(step: number) {
    this.total = 0;
    this.step = step;
  }

  advance(): void {
    this.total = this.total + this.step;
  }
}

export function selfReferential(n: number): number {
  const counter = new Counter(n > 0 && n < 100 ? n | 0 : 3);
  for (let i = 0; i < 8; i++) {
    counter.advance();
  }
  return counter.total;
}

// A field whose own value feeds a *fraction*. If the fixpoint concluded "whole"
// from a seed of zero and never revisited it, this would be rounded.
class Halving {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
  halve(): void {
    this.value = this.value / 2;
  }
}

export function keepsAFraction(n: number): number {
  const halving = new Halving(n | 0);
  halving.halve();
  halving.halve();
  return halving.value * 4;
}

// A field that can reach NaN through itself. `0 / 0` once is enough.
// Each of these carries a `tag` it never uses, and that is not decoration:
// `Halving`, `Poisoned`, `Signed` and `Doubling` would otherwise all be "one
// `number` field" and merge into a single layout, because TypeScript is
// structurally typed and so is the layout table. The merge is correct — the
// narrowing then joins every class's stores, so one fraction keeps all four
// wide — and it makes the four cases indistinguishable from outside. A distinct
// shape each is what lets a test say which one holds.
class Poisoned {
  value: number;
  tag: number;
  constructor(value: number) {
    this.value = value;
    this.tag = 1;
  }
  poison(n: number): void {
    this.value = n === 0 ? this.value / n : this.value + 1;
  }
}

export function reachesNaN(n: number): number {
  const poisoned = new Poisoned(n | 0);
  poisoned.poison(n | 0);
  return poisoned.value === poisoned.value ? 1 : 2;
}

// A field that can hold negative zero, which an integer slot cannot and only
// `1 / x` can tell from zero.
class Signed {
  value: number;
  tag: number;
  first: number;
  constructor() {
    this.value = 0;
    this.tag = 2;
    this.first = 0;
  }
  set(n: number): void {
    this.value = n < 0 ? -0 : 0;
  }
}

export function keepsNegativeZero(n: number): number {
  const signed = new Signed();
  signed.set(n);
  return 1 / signed.value < 0 ? 1 : 2;
}

// A field whose self-reference grows past int32. The recursion is what makes
// this the interesting case: a single store of a large constant is easy, and a
// field that *doubles itself* needs the fixpoint to keep widening.
class Doubling {
  value: number;
  tag: number;
  first: number;
  second: number;
  constructor() {
    this.value = 1;
    this.tag = 3;
    this.first = 0;
    this.second = 0;
  }
  double(): void {
    this.value = this.value * 2;
  }
}

export function growsPastInt32(n: number): number {
  const doubling = new Doubling();
  const times = n > 0 && n < 40 ? (n | 0) + 34 : 36;
  for (let i = 0; i < times; i++) {
    doubling.double();
  }
  return doubling.value > 2147483647 ? 1 : 2;
}

// Two classes sharing a field prefix, where one stores a fraction. Base-first
// layout means a store through the base can land in either, so the narrowing
// has to consider both — and a fixpoint per layout would miss it.
class Base {
  slot: number;
  constructor(slot: number) {
    this.slot = slot;
  }
}

class Derived extends Base {
  extra: number;
  constructor(slot: number, extra: number) {
    super(slot);
    this.extra = extra;
  }
  fracture(): void {
    this.slot = this.slot / 3;
  }
}

export function sharedPrefix(n: number): number {
  const derived = new Derived(n | 0, 1);
  derived.fracture();
  return derived.slot * 3;
}
