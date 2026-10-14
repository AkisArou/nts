// A base and a derived class declaring the same private name.
//
//     class Base    { #count = 0;   bumpBase()    { return ++this.#count; } }
//     class Derived extends Base
//                   { #count = 100; bumpDerived() { return ++this.#count; } }
//
// Two fields in JavaScript — that is what the `#` is for — and one slot here
// until 2026-09-10. The derived's was dropped by a dedup that matched on name,
// both classes read and wrote the base's storage, and node answered 2102 where
// this answered 102502. A wrong answer, with no crash and no refusal.
//
// # Why the numbers below are shaped the way they are
//
// Each counter starts somewhere the other cannot reach: 0 and 100, then 1000 and
// 10000. A fixture where both start at zero passes with one slot as easily as
// with two, and that is exactly the program the defect survived.
//
// The `Deeper` chain is here because a third class shadowing the same name
// again has to keep three slots apart without disturbing any of them — and
// `bumpBase` must still read slot 0 through a `Base *` however many layers sit
// above it.
//
// What separates the copies is `Field::declared_by`, the class that declared
// each one, stated where it is known rather than derived from a name. An
// earlier fix instead renamed the inherited copy to `#count@t1`: correct on a
// lane that addresses a field by index, and `NoSuchFieldError` on one that
// addresses it by name. C spells the distinction its own way, in `c_member_at`.
//
// # Controls
//
// `separateNames` is a derived class using a name its base does not, which is
// every other private field in the tree and the case that always worked.
// `publicIsShared` is the mirror: a *public* field redeclared by a derived class
// is the same property in JavaScript and must go on sharing one slot, which is
// what the same dedup is for.
// `inheritedOnly` is a derived class that inherits `#count` and does **not**
// redeclare it, which is the far commoner program. Its answer is right whether
// or not the layout is, so it is a control this example's own comparison cannot
// fail on — `compiler/core/tests/private_name_slots.rs` is what reads it, and
// what caught the phantom second slot that keeping both copies unconditionally
// gave it.

class Base {
  #count = 0;
  bumpBase(): number {
    this.#count += 1;
    return this.#count;
  }
}

class Derived extends Base {
  #count = 100;
  bumpDerived(): number {
    this.#count += 1;
    return this.#count;
  }
}

class Deeper extends Derived {
  #count = 1000;
  bumpDeeper(): number {
    this.#count += 1;
    return this.#count;
  }
}

/** Under test: two counters that must not meet. */
export function twoCounters(n: number): number {
  const d = new Derived();
  d.bumpBase();
  d.bumpDerived();
  return d.bumpBase() * 1000 + d.bumpDerived() + n * 0;
}

/** Three of them, so the distinction has to hold across two layers. */
export function threeCounters(n: number): number {
  const d = new Deeper();
  d.bumpBase();
  d.bumpDerived();
  d.bumpDeeper();
  return d.bumpBase() * 1000000 + d.bumpDerived() * 1000 + d.bumpDeeper() + n * 0;
}

/** The base's method still reads the base's slot through a base-typed binding. */
export function throughTheBase(n: number): number {
  const d: Base = new Deeper();
  return d.bumpBase() * 10 + n * 0;
}

class Separate extends Base {
  #total = 100;
  bumpSeparate(): number {
    this.#total += 1;
    return this.#total;
  }
}

/** Control: a private name the base does not declare. */
export function separateNames(n: number): number {
  const s = new Separate();
  s.bumpBase();
  return s.bumpSeparate() * 1000 + s.bumpBase() + n * 0;
}

class PublicBase {
  shared = 5;
  readBase(): number {
    return this.shared;
  }
}

class PublicDerived extends PublicBase {
  override shared = 9;
}

/** Control: a public field redeclared is one property and must share a slot. */
export function publicIsShared(n: number): number {
  const p = new PublicDerived();
  return p.readBase() * 100 + p.shared + n * 0;
}

class Inheritor extends Base {
  extra = 3;
  withExtra(): number {
    return this.bumpBase() * 10 + this.extra;
  }
}

/** Control: `#count` inherited and not redeclared, which is one slot. */
export function inheritedOnly(n: number): number {
  const i = new Inheritor();
  i.bumpBase();
  return i.withExtra() + n * 0;
}
