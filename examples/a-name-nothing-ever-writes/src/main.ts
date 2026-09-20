// `var g;` with no annotation and nothing that assigns it.
//
// The checker types it `any`, whose representation is "nothing" — `HirType::Void`
// — and `unwritten` needs a value to bind, because the name is *carried* from
// its declaration to its first assignment through block parameters and merges.
// A type with no width has no zero to carry, so the declaration was refused.
//
// The refusal was the case with the **least** in it. All of these lowered:
//
//     var g: number;   g = 2;      annotated
//     var g;           g = 2;      evolving — the assignment types it
//     let g: string | undefined;   an absence the type admits
//
// and `var g;` alone did not.
//
// # `in_a_slot` already answered this, one position over
//
// `Erased` is the only representation with an `undefined` in it, and `in_a_slot`
// is the single place a widthless representation is mapped to it. Its doc said
// it was asked "at the two places a representation becomes a slot — an array's
// element and a tuple's position", and excluded a binding: *"a function's
// result, a parameter and a binding are not slots in this sense: they hand
// `undefined` back by having nothing there."*
//
// True of a result and a parameter, and false of this binding, which has to be a
// value for every block after it. So the exclusion was narrowed rather than the
// mapping duplicated — a result and a parameter stay out, because nothing reads
// them back.
//
// 9 files of the slice-1 `test/language` population; 5 pass and 4 advance to
// `eval`, which is a declared non-goal.
//
// The refusal that remains for a type with no zero now **names the type**:
// "a declaration without an initializer" describes every `let x;` in the
// language, and the ones that reach it are the subset whose type has no zero.

/** Declared, never assigned, never read. */
export function neverMentionedAgain(n: number): number {
  var unused;
  return n;
}

/** Declared, never assigned, and read — which is `undefined`. */
export function readBeforeAnythingWrites(n: number): number {
  var g;
  return (g === undefined ? 1 : 0) + n * 0;
}

/** The same through `typeof`, which is how a program usually asks. */
export function typeofAnUnwrittenName(n: number): number {
  let g;
  return (typeof g === "undefined" ? 1 : 0) + n * 0;
}

/** Control: an assignment types it, and the slot is a number rather than erased. */
export function evolvingFromAnAssignment(n: number): number {
  var g;
  g = 2;
  return g + n * 0;
}

/** Control: an annotation types it, and the checker proves the write comes first. */
export function annotatedAndWrittenFirst(n: number): number {
  var g: number;
  g = 2;
  return g + n * 0;
}

/**
 * Control: a union that admits the absence, read before it is written.
 *
 * This is the case `unwritten` was built for and it must keep its own slot —
 * `ConstNull` on a reference, not an erased tag.
 */
export function anAbsenceTheTypeAdmits(n: number): number {
  let joined: string | undefined;
  if (n > 0) {
    joined = "ab";
  }
  return (joined === undefined ? 0 : joined.length) + n * 0;
}

/**
 * Control for the position `in_a_slot` already served: an array hole.
 *
 * `[,]` is `undefined[]` and the default must fire. A numeric placeholder would
 * hand back 0 and answer 0 here instead of 23.
 */
export function aHoleStillReadsAsAbsent(n: number): number {
  const [x = 23] = [,];
  return x + n * 0;
}
