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
// The `Deeper` chain is here because the fix renames the **inherited** copy, so
// a third class shadowing the same name again has to rename two of them without
// disturbing either — and `bumpBase` must still read slot 0 through a `Base *`
// however many layers sit above it.
//
// # Controls
//
// `separateNames` is a derived class using a name its base does not, which is
// every other private field in the tree and the case that always worked.
// `publicIsShared` is the mirror: a *public* field redeclared by a derived class
// is the same property in JavaScript and must go on sharing one slot, which is
// what the same dedup is for.

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

/** Three of them, so the rename has to hold across two layers. */
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
