// expect: lowers
//
// **`new B() instanceof A` answers `true` where node answers `false`, and
// nothing is refused.**
//
// Two classes whose fields match exactly share one layout, and a layout carries
// a list of the types it covers:
//
//     layouts.iter().find(|layout| layout.types.contains(class))
//
// `instance_of` resolves each class in the test to a layout and compares the
// object's descriptor with that layout's. When `A` and `B` are the same layout
// they are the same descriptor, so the comparison cannot separate them. The
// emitted C for all three functions below is the same line:
//
//     v4 = (nts_is_class(v3, &nts_desc_NtsObj_A));
//
// There is one descriptor in the program. `class B` does not exist at runtime;
// it *is* `A`.
//
// # Why this is a `lowers` guard and not a refusal
//
// Nothing refuses. The program compiles, runs, and answers the wrong thing, so
// there is no diagnostic to assert on and a refusal-shaped fixture would have
// nothing to say. What this file asserts is that the program still lowers; the
// wrong *answer* is asserted by `examples/two-classes-one-descriptor` --
// deliberately absent, because an example must agree with node and this one
// cannot yet.
//
// That absence is the honest form. Writing the example and letting it fail
// would make the gate red for everyone on a defect nobody is fixing today;
// writing it and trimming it until it passes would be the thing this tree calls
// a vacuous control.
//
// # How it was found
//
// Not by looking for it. `examples/a-private-name-is-a-brand` was written to
// check that `#list in value` distinguishes a class from a decoy declaring a
// private name spelled the same way, and it failed with 58 cases disagreeing
// after the restriction to the declaring class was already correct and verified
// by hand. The decoy was an exact structural twin of the class under test, so
// the fixture was measuring this instead. Giving the decoy one extra field
// separated the two questions and the private-name fixture passes.
//
// A fixture that fails for a reason other than the one it was written for is
// the same trap as one that passes for a reason other than the one it was
// written for, and it is harder to notice because failure looks like work to do.
//
// # How far it reaches, measured
//
// **Not to native classes.** The obvious escalation is `util/src/types.ts`,
// whose ~16 typed-array predicates are each `value instanceof Uint8Array`, and
// typed arrays are the purest same-shape case there is -- `Uint8Array` and
// `Int8Array` differ in element interpretation and in nothing a layout would
// see. `util` publishes `types`, so a collapse there would make
// `isUint8Array(new Int8Array(2))` answer `true` on a published surface.
//
// It does not. Typed-array `instanceof` never reaches the layout lookup:
//
//     v46 = nts_is_view_kind(v44, v45);
//
// an element-kind test rather than `nts_is_class`. These are `View`/`AnyView`
// in this representation and never `Object(TypeId)`. Checked in the emitted C
// rather than argued: `i8IsNotU8`, `u16IsNotU8`, `f64IsNotU8` and `u8IsNotF64`
// all agree with node.
//
// So the blast radius is **user-declared classes that share a field shape**,
// and nothing with an element kind, nothing native, no host surface. That is a
// much smaller and more checkable set than "anything using `instanceof`", and
// it is the reason this is filed rather than treated as an emergency.
//
// # What decides the fix
//
// `X.isX(value)` is `value instanceof X` throughout this profile --
// `BlockList.isBlockList`, `SocketAddress.isSocketAddress`, `assert`'s
// `AssertionError`, `util.types`' whole surface. Those are the *documented*
// predicate rather than an incidental use that could be rewritten around, and
// node's answer is identity. **A profile whose `instanceof` cannot separate two
// declared classes cannot implement them.**
//
// # What it would take
//
// A descriptor per class rather than per layout. Sharing the *struct* between
// structurally identical classes is a real economy and is not the problem --
// sharing the identity is. The two backends both compare descriptors, so this
// is one decision affecting both, and it is a representation change rather than
// a lowering fix: it belongs with the Node and JVM lanes rather than in a
// unilateral commit.
//
// Nothing in `runtime/node` is known to depend on it today, which is why it is
// filed rather than rushed. What makes it worth filing loudly is that it is
// silent: every other defect this week announced itself with a diagnostic.

class A {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}

/** An exact structural twin of `A`. */
class B {
  x: number;
  constructor(n: number) {
    this.x = n;
  }
}

/** Control: the true case, which is right. */
export function aIsA(n: number): boolean {
  return new A(n) instanceof A;
}

/** Answers `true`. Node answers `false`. */
export function bIsNotA(n: number): boolean {
  return (new B(n) as unknown) instanceof A;
}

/** And the other direction, also `true`. */
export function aIsNotB(n: number): boolean {
  return (new A(n) as unknown) instanceof B;
}
