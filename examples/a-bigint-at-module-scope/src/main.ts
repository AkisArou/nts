// `let total: bigint = 1n` at module scope, which was refused as *"a module-scope
// variable holding a reference"*.
//
// **A bigint is not a reference.** It is an `__int128` — sixteen bytes of value,
// no allocation and nothing to root — so it is exactly as storable as a
// `double`. A bigint *local* compiled the whole time; only the global slot said
// no.
//
// `can_be_global` admits `is_scalar() || may_hold_a_reference()`, and
// `is_scalar` excludes a bigint for a reason that is true and unrelated: it does
// not fit in a register. Storing one in a global has nothing to do with
// registers, so the two questions had been answered with one predicate.
//
// # The message was the opposite of the condition
//
// What reaches that refusal is a type that is *neither* a scalar *nor* a
// reference, and the sentence said "holding a reference". A reader of
// `let total: bigint = 1n` was sent looking for a reference that is not there.
// It names the representation now, which is what a census row ranks by and what
// a person acts on.
//
// Found by reading `can_be_global` rather than from a failing file: the census
// row it sits under is 5 files and none of them is a bigint. The predicate was
// wrong for a type the corpus does not exercise, which is the kind of thing only
// reading finds.

let total: bigint = 1n;
const big: bigint = 7n;
let past: bigint = 9007199254740993n;

/** A bigint global that is written after its declaration. */
export function accumulates(n: number): number {
  total = total + 41n;
  const seen = Number(total);
  total = 1n;
  return seen + n * 0;
}

/** A bigint global that is only read. */
export function readsAConstant(n: number): number {
  return Number(big) * 2 + n * 0;
}

/**
 * Past what a double can hold, which is the point of the type.
 *
 * `9007199254740993` is not representable as a `double`; if this were ever
 * lowered through one, the answer would be 9007199254740992 and this arm would
 * say so.
 */
export function keepsPrecisionADoubleWouldLose(n: number): number {
  past = past + 1n;
  const exact = past === 9007199254740994n ? 1 : 0;
  past = 9007199254740993n;
  return exact + n * 0;
}

/** The control that always worked: the same arithmetic in a local. */
export function aLocalBigintStillWorks(n: number): number {
  let t: bigint = 1n;
  t = t + 1n;
  return Number(t) + n * 0;
}
