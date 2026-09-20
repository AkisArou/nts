// `var x = null; x = 2;` — a name with no annotation whose type the checker
// builds from what is assigned to it afterwards.
//
// The `null` written at the declaration was refused as *"`null` or `undefined`
// where what it stands in for is not a reference"*, while the annotated spelling
// `var x: number | null = null` lowered the whole time. That asymmetry is the
// tell: the annotation reached the storage and the evolved type reached nothing.
//
// # Why the evolved type needed widening
//
// `contextual_type` reads a declaration in three steps, and the order is the
// whole of it. The written annotation first — *not* the name's type, because the
// checker narrows the name by its initializer, so `let head: Element | null =
// null` types `head` as `null` right there, which is true and is not what the
// storage is. Then the name's own type. Then, new, what the references settled
// on.
//
// That third source answers `f64` for `var x = null; x = 2`, and it is right
// about what it was asked: `evolved_type` walks the nodes carrying the symbol
// and **skips the declaration's own name**, so every observation it sees is a
// number. The `null` the slot carries until the assignment is not a reference
// and is nowhere in that answer — so the slot has to be the erased value that
// holds both, which is exactly what the annotated spelling gets.
//
// A *reference* evolution needs no widening at all: a nullable pointer already
// holds the absence, which is why `string | null` is one pointer and not a tag.
// `evolvesToAString` is that arm.
//
// # Scalars only, and a native pointer is what says so
//
// The first version widened anything that was not managed, and
// `let held: Ptr<c_int> | null = null` is not managed. That declaration is
// *refused* — a module-scope variable has no storage for a native pointer — and
// the refusal is load-bearing: `local_addresses_cannot_outlive_or_free_their_storage`
// depends on it to stop a stack address escaping into a global. Widening it to
// erased let the address through, and the gate caught it where six probes of
// this file's own shapes did not.
//
// So the rule is `is_scalar()`: a `bool`, an integer or a double, which are the
// representations with no room for an absence beside them. Everything else
// either already holds one or has no business being widened.
//
// # Two slots, because the global has its own
//
// Fixing the literal moved the refusal one step, to *"an erased value where a
// concrete representation is wanted"*: `settled_global_type` had also settled on
// `f64`, for the same reason and from the same function. A module-scope
// declaration initialised with an absence widens there too.

var evolving = null;
var fromUndefined = undefined;
var evolvingReference = null;

/** The module-scope shape the corpus writes. */
export function evolvesToANumber(n: number): number {
  evolving = 2;
  const seen = evolving === 2 ? 1 : 0;
  evolving = null;
  return seen + n * 0;
}

/** The `undefined` spelling of the same declaration. */
export function evolvesFromUndefined(n: number): number {
  fromUndefined = 3;
  const seen = fromUndefined === 3 ? 1 : 0;
  fromUndefined = undefined;
  return seen + n * 0;
}

/**
 * A reference evolution, which needs no widening.
 *
 * A nullable pointer already holds `null`, so this must keep a pointer rather
 * than pay for a tag.
 */
export function evolvesToAString(n: number): number {
  evolvingReference = "ab";
  const seen = evolvingReference.length;
  evolvingReference = null;
  return seen + n * 0;
}

/** The same thing inside a function, which has its own binding path. */
export function evolvesInALocal(n: number): number {
  let x = null;
  x = 2;
  return (x === 2 ? 1 : 0) + n * 0;
}

/**
 * The control the existing arm was written for: an annotation the checker
 * narrows.
 *
 * `head` is typed `null` at its declaration and `string | null` is the storage.
 * A reader of the *name* rather than the annotation answers the narrow one, and
 * this arm is what says so.
 */
export function anAnnotationIsNotTheNarrowedName(n: number): number {
  let head: string | null = null;
  const before = head === null ? 1 : 0;
  head = "ab";
  return before * 10 + head.length + n * 0;
}

/** Controls: the other two declarations that share the arm. */
class Holder {
  next: string | null = null;
}

export function aPropertyDefault(n: number): number {
  return (new Holder().next === null ? 1 : 0) + n * 0;
}

export function aParameterDefault(n: number): number {
  const check = (v: string | null = null): number => (v === null ? 1 : 0);
  return check() + n * 0;
}
