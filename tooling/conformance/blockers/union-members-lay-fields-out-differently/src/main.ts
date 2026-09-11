// expect: `at` on a union, whose members lay their fields out differently
//
// **Narrowed on 2026-09-11.** This fixture used to hold `kind` on `Left |
// Right` -- a discriminated union whose members declare the discriminant first
// -- and that now lowers. Where every arm puts a field at the same offset with
// the same name and representation, the read is licensed by exactly the rule
// base-first layout gives a subclass, and `examples/a-member-every-arm-puts-in-
// the-same-place` is the guard.
//
// What is left is the two shapes where the offsets genuinely disagree, and they
// are different from each other in a way worth keeping apart.
//
// # A field with the same name and a different representation
//
// `sameNameDifferentType` is the one a weaker rule gets wrong. Both arms
// declare `at` first, so a rule matching on **names** alone would emit a load
// at offset zero and read a `double` out of a slot holding a pointer. Nothing
// would refuse and nothing would crash; the answer would just be a number made
// of a pointer's bits.
//
// That is why the check is `same_slot` -- names *and* representations -- and
// why this fixture exists rather than a comment saying so.
//
// # A field past the disagreement
//
// `pastADisagreement` reads `tail`, which is field 1 in both arms and agrees in
// both. It still refuses, because field 0 does not agree and so the offsets
// after it are unrelated. The agreement is a **prefix**, not a set: a field
// only sits at a known offset if everything before it does.
//
// This is the honest cost of the representation. Reaching `tail` would need the
// discriminant tested and one load per arm, which is a different feature --
// and the union has no discriminant to test here, since `Unerase` is a
// reinterpretation and every object carries the same tag.
//
// # Why the controls are in the example and the refusals are here
//
// A refused function leaves the differential silently: `nts check` compares the
// functions that survived, so an example holding these would report agreement
// over the ones that lowered and go green having stopped testing the two it was
// written for. The positive half lives in the example and the negative half
// lives here, which is the split this directory exists for.

/** Control: one class, so the field has one offset. Lowers. */
export class Single {
  at: number;
  tail: number;
  constructor() {
    this.at = 1;
    this.tail = 2;
  }
}

export function singleClass(s: Single): number {
  return s.at;
}

class A {
  at: number;
  tail: number;
  constructor() {
    this.at = 1;
    this.tail = 2;
  }
}

class B {
  at: string;
  tail: number;
  constructor() {
    this.at = "x";
    this.tail = 3;
  }
}

/** Under test: same name, different representation, at the same index. */
export function sameNameDifferentType(n: number): number {
  const v: A | B = (n & 1) === 1 ? new A() : new B();
  return typeof v.at === "number" ? v.at : v.at.length;
}

/** Under test: a field that agrees, behind one that does not. */
export function pastADisagreement(n: number): number {
  const v: A | B = (n & 1) === 1 ? new A() : new B();
  return v.tail;
}
