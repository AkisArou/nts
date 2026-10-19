// expect: `valueOf` and `toString` both answer objects
//
// `a > b` where both of an object's conversion members answer **objects**.
//
// # The row this held closed on 2026-09-13
//
// `a > b` between objects is `ToPrimitive` on each with hint `number`, and it
// used to emit `gt` on two pointers — true for every input, 29 of 29 cases
// disagreeing with node. It was refused by name, and is now **answered**:
// `tests/programs/a-comparison-through-valueof` is 87 cases across three functions on
// C, LLVM and the JVM, including the specification's fallthrough where
// `valueOf` returns an object and `toString` is what answers.
//
// This fixture keeps the part that is still a refusal, which is one case.
//
// # Why it is a refusal rather than a conversion
//
// JavaScript throws a `TypeError` when neither method produces a primitive.
// This compiler has no cross-call throw to do that with — a `throw` is a jump
// within one function and `nts_uncaught` is the outer edge — so it says so at
// compile time instead. That is the honest shape: the alternative is comparing
// addresses, which is what this row started as.
//
// An object that declares **neither** member is not that case, which this
// fixture's subject was until 2026-10-19: it inherits `Object.prototype`'s,
// whose `toString` answers `"[object Object]"`, so two such objects compare as
// two equal strings and node throws nothing.
// `tests/programs/a-conversion-through-valueof-under-plus` (`neither`) answers it.
//
// # And a second, narrower one
//
// `valueOf(): number` on one side and `toString(): string` on the other is a
// comparison between a double and a pointer. The specification converts again
// after the first conversion; this does not, and refuses rather than picking a
// representation it is not entitled to pick.
//
// # Three controls, all of which compile
//
//     numbers            compared, and always were
//     strings            compared, and always were
//     explicitTag        the same comparison through a member it could call
//
// The last is the one that matters: it is the program the author would write
// instead, so if it ever stops working the refusal has spread beyond its
// subject.

class Opaque {
  tag: number;
  constructor(t: number) {
    this.tag = t;
  }
}

class Hollow {
  valueOf(): object {
    return {};
  }
  toString(): object {
    return {};
  }
}

/** Under test: both members answer objects, which is node's `TypeError`. */
export function bothObjects(n: number): number {
  const a = new Hollow();
  return (a > new Hollow() ? 1 : 0) + (n & 0) + 1;
}

/** Control: numbers compare, and always did. */
export function numbers(n: number): number {
  return ((n & 7) > 3 ? 10 : 0) + ((n & 7) <= 3 ? 1 : 0);
}

/** Control: strings compare, and always did. */
export function strings(n: number): number {
  const s = (n & 1) === 0 ? "a" : "z";
  return (s < "m" ? 10 : 0) + (s >= "a" ? 1 : 0);
}

/** Control: the same comparison written through a member it could call. */
export function explicitTag(n: number): number {
  const a = new Opaque(n & 7);
  return (a.tag > 3 ? 10 : 0) + 1;
}
