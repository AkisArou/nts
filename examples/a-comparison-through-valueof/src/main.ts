// `a > b` where the operands are objects, which JavaScript answers by
// `ToPrimitive` on each with hint `number` — `valueOf` first, then `toString`.
//
// # It was a wrong answer that ran, then a refusal, and now an answer
//
// The lowering emitted `gt %1, %7` on two `object.new` pointers, so `a > b` was
// **true for every input** where node answers from the degrees: 29 of 29 cases
// disagreed. It was refused by name on 2026-09-13 and is answered here.
//
// # Why this is a static dispatch and not a prototype walk
//
// `valueOf` and `toString` are members this compiler already puts on the
// descriptor, so "does this object have a `valueOf`" is a question about the
// **type**. The blocker that held this predicted exactly that — "reachable
// machinery wanting an ordering rather than missing machinery" — and the
// ordering is the whole of it: `valueOf`, then `toString`, then refuse.
//
// # The arm that is the specification rather than a convenience
//
// `Boxed.valueOf()` returns an **object**. The specification says to try the
// next method when the first does not produce a primitive, so this falls
// through to `toString` — and a compiler that took the first method it found
// would compare two pointers again, silently, which is the bug this row started
// as. Without this arm the example would pass under an implementation that
// never looks past `valueOf`.
//
// # What is not here, and why
//
// `a > 3` — an object against a number — is **TS2365** and never reaches the
// compiler, so the mixed case cannot be written. And an object with neither
// method is refused rather than answered: JavaScript throws a `TypeError`
// there, and this compiler has no cross-call throw to do it with, so it says so
// at compile time. `blockers/a-relational-comparison-between-objects` holds it.

class Celsius {
  degrees: number;
  constructor(d: number) {
    this.degrees = d;
  }
  valueOf(): number {
    return this.degrees;
  }
  toString(): string {
    return "C" + this.degrees;
  }
}

/** `valueOf` on both sides: a numeric comparison. */
export function numeric(n: number): number {
  const a = new Celsius(n & 7);
  const b = new Celsius(3);
  return (a > b ? 1 : 0) + (a < b ? 10 : 0) + (a >= b ? 100 : 0) + (a <= b ? 1000 : 0);
}

class Named {
  label: string;
  constructor(l: string) {
    this.label = l;
  }
  toString(): string {
    return this.label;
  }
}

/** `toString` only: a string comparison, and the order is lexicographic. */
export function lexicographic(n: number): number {
  const a = new Named((n & 1) === 0 ? "a" : "z");
  const b = new Named("m");
  return (a > b ? 1 : 0) + (a < b ? 10 : 0);
}

class Inner {
  tag: number;
  constructor(t: number) {
    this.tag = t;
  }
}

class Boxed {
  inner: Inner;
  constructor(t: number) {
    this.inner = new Inner(t);
  }
  /** Legal, and **not** a conversion — the specification tries the next one. */
  valueOf(): Inner {
    return this.inner;
  }
  toString(): string {
    return "B" + this.inner.tag;
  }
}

/** `valueOf` returns an object, so `toString` is what answers. */
export function fallsThrough(n: number): number {
  const a = new Boxed(n & 7);
  const b = new Boxed(3);
  return (a > b ? 1 : 0) + (a < b ? 10 : 0);
}
