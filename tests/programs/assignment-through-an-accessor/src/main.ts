// `o.x += 1` and `o.x ||= 2` where `x` is an accessor, refused until
// 2026-09-12 as `an assignment that reads through an accessor`.
//
// # The place knew half of it
//
// A write target is a `Place`, and for an accessor that was `Place::Setter` —
// the receiver and the setter to call. A plain `o.x = v` needs nothing else,
// which is why the gap was narrower than the message suggested. A *compound*
// assignment reads before it writes, and the read is a call to the getter,
// which the place did not carry.
//
// So the getter travels with the setter now, resolved where the place is built
// rather than at the assignment: two places asking the hierarchy the same
// question is how they come to disagree about the answer.
//
// # The counts are the test
//
// Every case here reports how many times the getter and the setter ran, and
// that is the point rather than thoroughness. `a.v ||= 99` on a truthy left
// must **not** call the setter at all, and `a.v += 3` must call each exactly
// once. A lowering that read twice, or wrote unconditionally, answers the same
// number for `a.v` and a different count — and a fixture reading only the value
// could not tell it from the correct one.
//
// # What the verifier caught
//
// The first version passed the value to the setter without coercing it, which
// a plain assignment had always done for itself. `??=` on a `number | undefined`
// accessor then handed the setter an `f64` where it wanted an erased slot, and
// the verifier said so — `CallArgumentType { expected: Erased, found: Float }`
// — rather than the program being wrong when it ran. The setter's declared type
// travels with the place too, for the store to coerce toward.
//
// # What is still refused
//
// A compound assignment through an accessor **whose value is erased**. The read
// and the result are one value there and want different types: `a.v ??= n` tests
// the read for absence, which needs the tag, and answers with it on the present
// path, where the assignment's type is `number` because `??=` has excluded the
// absent arm. A *field* in the same shape lowers, because the flow analysis
// tracks the slot and narrows the read; a getter call is not a slot and has
// nothing to narrow. Refused by name rather than lowered into a cast from
// `NtsValue` to a double.

let gets = 0;
let sets = 0;

class Counted {
  #v = 0;
  get v(): number {
    gets += 1;
    return this.#v;
  }
  set v(x: number) {
    sets += 1;
    this.#v = x;
  }
}

/** Under test: `+=` reads once and writes once. */
export function compoundCounts(n: number): number {
  gets = 0;
  sets = 0;
  const a = new Counted();
  a.v = n & 7;
  a.v += 3;
  return a.v * 10000 + gets * 100 + sets;
}

/** Under test: `||=` on a truthy left must not write. */
export function logicalShortCircuits(n: number): number {
  gets = 0;
  sets = 0;
  const a = new Counted();
  a.v = (n & 1) + 1;
  a.v ||= 99;
  return a.v * 10000 + gets * 100 + sets;
}

/** Under test: `&&=` on a falsy left must not write either. */
export function andAssign(n: number): number {
  gets = 0;
  sets = 0;
  const a = new Counted();
  a.v = 0;
  a.v &&= 7;
  return a.v * 10000 + gets * 100 + sets + (n & 1);
}

/** Under test: `??=` where the accessor's value cannot be absent. */
export function nullishOnANonNullable(n: number): number {
  gets = 0;
  sets = 0;
  const a = new Counted();
  a.v = n & 7;
  a.v ??= 99;
  return a.v * 10000 + gets * 100 + sets;
}

/** Under test: several in a row, so each read sees the previous write. */
export function mixedOperators(n: number): number {
  gets = 0;
  sets = 0;
  const a = new Counted();
  a.v = (n & 3) + 1;
  a.v *= 2;
  a.v -= 1;
  a.v **= 2;
  return a.v * 10000 + gets * 100 + sets;
}
