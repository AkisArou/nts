// `sym.description` and `sym.toString()` — a symbol's two members, read rather
// than converted.
//
// `String(sym)` already lowered: the conversion arm calls `nts_symbol_to_string`
// and its comment says the helper "already exists in all three backends -- the
// C runtime, `hir::runtime`'s table, LLVM's signatures and the JVM's `ops`".
// The ledger row for the *member* form said the same thing from the other side:
// both helpers "exist and are tested, and nothing lowers a member access to
// them yet".
//
// Both were exactly true, so this feature is two arms in the lowering and **no
// runtime surface at all** — nothing to add to `hir::runtime`, nothing to
// regenerate in LLVM's signatures, no backend to red-gate while it catches up.
//
// # The control that makes it mean something
//
// `sameAsConversion` asks the two spellings for the same answer. They reach one
// helper, so a wrong wiring in either arm shows up as a disagreement between
// them rather than as a number that merely looks plausible — and a wrong answer
// here would be plausible, because every string length in this file is small.
//
// # `description` is `string | undefined`
//
// `nts_symbol_description` returns a possibly-null `NtsString *`, which is what
// this compiler already means by an absent string: null and undefined are one
// value in a compiled program. So `Symbol()` with no description answers
// `undefined` through the null test the compiler already lowers, and
// `describedOrNot` varies which it gets at run time so a constant on either
// side would show.

const tagged = Symbol("hello");
const bare = Symbol();

/** The control: a symbol is a value, and two reads of one name are one object. */
export function isAValue(n: number): number {
  const s = tagged;
  return s === tagged ? (n & 7) + 1 : 0;
}

/** `description` where there is one. */
export function described(n: number): number {
  const d = tagged.description;
  return d === undefined ? 0 : d.length + (n & 7);
}

/** `description` where there is not — the same read, the other answer. */
export function undescribed(n: number): number {
  const d = bare.description;
  return d === undefined ? 100 : d.length + (n & 7);
}

/** Either, decided at run time, so neither branch can be folded away. */
export function describedOrNot(n: number): number {
  const s = (n & 1) === 0 ? tagged : bare;
  const d = s.description;
  return d === undefined ? 100 : d.length + (n & 7);
}

/** `toString()`, the method form. */
export function stringified(n: number): number {
  return tagged.toString().length + (n & 7);
}

/**
 * The two spellings reach one helper, so they must agree.
 *
 * `String(sym)` lowered before this change and `sym.toString()` did not; if the
 * member arm were wired to the wrong helper this is what would catch it, and a
 * length comparison alone would not.
 */
export function sameAsConversion(n: number): number {
  const viaMethod = tagged.toString();
  const viaConversion = String(tagged);
  return viaMethod === viaConversion ? (n & 7) + 1 : 0;
}
