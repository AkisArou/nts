// expect: `at` on a union whose members share no leading field
//
// **The message changed on 2026-09-12 and the fixture did not.** It used to
// read "whose members lay their fields out differently", which is a claim about
// the arms that nothing had tested: every member read on an erased receiver got
// that sentence, including a getter that is not a field in any arm and a union
// with exactly one object in it. `shared_field` already distinguishes four
// reasons for declining and was throwing the distinction away.
//
// This matters for ranking rather than for wording. The old text is the refusal
// census's **number one row** -- 57 distinct things across all 23 modules -- and
// one of its four causes is something to build while the others are correct
// refusals or a different row entirely. A row that cannot be split cannot be
// ranked.
//
// **Landed, reverted and landed again on 2026-09-11**, and the middle step is
// the finding. The discriminant case now lowers through `OpKind::SharedFieldGet`
// and lives in `examples/a-member-every-arm-puts-in-the-same-place`; what is
// below it here is what must go on refusing.
//
// Where every arm puts a field at the same index with the same name and
// representation, the read is sound and on C and LLVM it is free -- a pointer
// cast between two structs with a common initial sequence is exactly what
// base-first layout already relies on, and `Unerase` is a reinterpretation
// against a coarse tag, so no discriminant has to be tested:
//
//     %1 = unerase %0 : managed<obj#1>
//     %2 = field.get %1.0 : managed<str>
//
// **The JVM cannot do that**, and it does not fail quietly:
//
//     java.lang.ClassCastException: class nts.gen.Right cannot be cast to
//     class nts.gen.Left
//
// Seventeen aborts in one example. The JVM floor absorbed it -- 168 against a
// floor of 167 -- which is the argument for reverting rather than against it: a
// floor one below the count cannot see one regression, and a throw is loud on
// one lane and only if someone looks, where a refusal is loud on all three.
// That was the JVM lane's call and it is the right one.
//
// # What it is waiting for, which is designed rather than open
//
// The HIR says *reinterpret*, and one machine can do that and one cannot. So
// the op has to state the **fact** -- these arms agree about this field -- and
// let each backend choose its instruction. Measured by the JVM lane rather than
// assumed, over 3000 mixed elements and three arms:
//
//     instanceof chain    1759 ns/pass
//     synthesised interface   6213 ns/pass    3.5x slower
//
// An interface makes every read a megamorphic `invokeinterface` whose itable
// lookup defeats inline caching, and it would change the arms' class shapes.
// The chain stays branch-predictable and its field loads inline. So the op
// carries **the arm type ids and the field index** -- not a field name, because
// the name is per-arm on the JVM even where the precondition makes them equal,
// and one fact with two derivations is the error this compiler keeps making.
//
// C and LLVM emit the pointer read they already would; the JVM emits one
// `instanceof`, one `checkcast` and one `getfield` per arm.
//
// The precondition is the op's whole contract: **every arm agrees about name,
// index and representation.** It is what makes the C read sound and what makes
// the chain sound, and it is one sentence both halves can be checked against.
//
// # Three shapes, and they are refused for different reasons
//
// `unionField` is the one that will lower when the op lands. The other two are
// the ones that must go on refusing afterwards, and they are different from each
// other in a way worth keeping apart.
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

class Left {
  kind: "l";
  n: number;
  constructor() {
    this.kind = "l";
    this.n = 1;
  }
}

class Right {
  kind: "r";
  s: string;
  constructor() {
    this.kind = "r";
    this.s = "xy";
  }
}

/**
 * Control: the discriminant, which every arm declares first. This **lowers**,
 * through the op described above, and is here so the contrast with the two
 * refusals below is in one file: same union, same kind of read, and the only
 * difference is whether the arms agree about the slot.
 */
export function unionField(n: number): number {
  const v: Left | Right = (n & 1) === 1 ? new Left() : new Right();
  return v.kind.charCodeAt(0);
}

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
