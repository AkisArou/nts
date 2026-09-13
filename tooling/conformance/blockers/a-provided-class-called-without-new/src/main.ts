// expect: a class this compiler provides, called without `new`
//
// `TypeError(m)` — a class value *called*, which JavaScript defines as
// `new TypeError(m)` and TypeScript accepts without complaint.
//
// # The refusal named the wrong thing until 2026-09-13
//
// This arrives at the plain-call path with no declaration in the compiled set,
// because its only declaration is in `lib.d.ts`. That path reported:
//
//     NTS1001 `TypeError`, a builtin this compiler does not provide
//
// which is false twice. The class *is* provided — it is the second entry of
// `hir::builtin::ERRORS`, and `constructed` below compiles and runs — and a
// reader sent to `hir::builtin` by that sentence finds nothing missing to add.
// What is missing is a `call` that constructs. The comment above that arm
// already said "two different failures wore one sentence"; this was a third.
//
// # Why the list is the whole of it
//
// Only a *provided* class can reach here. A class the program declares is
// rejected by the checker first — `Declared(n)` is TS2348 "Value of type
// 'typeof Declared' is not callable. Did you mean to include 'new'?", measured
// rather than assumed — so it never becomes a lowering question at all. That is
// why the arm tests `PROVIDED_ERROR_NAMES` rather than asking whether the
// callee is a class.
//
// # Corpus demand: zero, and that is a measurement
//
// 239 lines of `runtime/node` name a provided error class as a callee and every
// one of them writes `new`. The instrument was checked both ways: a synthetic
// control fires, and the 239-to-0 drop across the `new` exclusion is the proof
// it ran on real data rather than matching nothing.
//
// # What building it needs
//
// A `call` that constructs — the same machinery `a-new-through-a-class-value`
// wants, since both need the token to carry an instance descriptor and a
// constructor. With no corpus site asking for either, the two rows are one
// feature and neither is worth building alone.

/** The control. The same class, with `new`: this compiles. */
export function constructed(m: string): string {
  return new TypeError(m).message;
}

/** The blocker. */
export function called(m: string): string {
  return TypeError(m).message;
}

/**
 * The second control: bound to a name first.
 *
 * It is the *call* that refuses, not the class appearing in callee position, so
 * this refuses too — and through a closure, which is why it reads as
 * `NTS1003 ... calls `Closure#call`` rather than repeating the message above.
 */
export function viaBinding(m: string): string {
  const C = TypeError;
  return C(m).message;
}
