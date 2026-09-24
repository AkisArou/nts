// A field every arm of a union places identically, where the arms are *classes*
// and the field narrows to an integer.
//
// # Why this shape had no fixture, and what it cost
//
// `OpKind::SharedFieldGet` is how a field reaches through an erased union: the
// op names the arms and each backend picks its instruction -- the pointer read
// on C and LLVM, one `instanceof`/`checkcast`/`getfield` per arm on the JVM.
// Every union fixture here was written with interfaces and object literals, and
// nothing narrows *their* fields: `hir::fields` decides a representation per
// `(layout, field)` from the stores it can see, and a literal's stores are as
// wide as the slot.
//
// A class initialises its fields with constants, so `weight = 1` is provably an
// `i32` and the layout takes it. `hir::fields::narrow` then moved the layouts
// and retyped every `FieldGet` that names them -- and not the shared read, whose
// operand is *erased* and so names no type to look up. The op kept the `f64`
// lowering gave it while the member became `int32_t`, which is the exact
// sentence that function's own header warns about: "the two have to move
// together or the emitter declares an `int32_t` member and assigns a `double`
// local from it."
//
// Both backends caught it and neither could say why:
//
//   C     NTS2006 a shared field read at a type its arms do not declare
//   JVM   NTS4001 emitting %14 moved the operand stack from 0 to -2
//
// The C message is `shared_field_load`'s deliberate check -- "checked rather
// than assumed: a disagreement here means lowering established the precondition
// wrongly, and the alternative to saying so is a load at the wrong width." It
// was right that something was wrong and wrong about who. The JVM's is the same
// stale width arriving as a stack-accounting disagreement, which is what a
// two-slot `double` looks like where a one-slot `int` was counted.
//
// So this example is the arm that fails without the fix, on two backends, for
// two different-looking reasons.

class Counter {
  weight = 1;
  bumped = 0;
}

class Tally {
  weight = 2;
}

type Weighed = Counter | Tally;

/**
 * The read under test. `weight` is at index 0 in both arms and narrows to an
 * integer in both, which is what makes the shared read legal *and* what made it
 * go stale.
 */
function weightOf(v: Weighed): number {
  return v.weight;
}

export function eitherArm(pick: number): number {
  const v: Weighed = pick > 0 ? new Counter() : new Tally();
  return weightOf(v);
}

/**
 * **The control**, and without it the case above proves little.
 *
 * `bumped` is a field only one arm has, so it is read through the class and not
 * through the union -- an ordinary `FieldGet`, which `narrow` has always
 * retyped. If a repair ever retypes the shared read by breaking the plain one,
 * this diverges and the other does not.
 */
export function throughTheClass(pick: number): number {
  const c = new Counter();
  c.bumped = pick & 0xff;
  return c.bumped + c.weight;
}
