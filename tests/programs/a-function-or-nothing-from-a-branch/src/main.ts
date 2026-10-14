// A function value chosen by a branch, where the other arm is `undefined`.
//
// Everywhere else a function type gets its layout from a *declaration* — a
// parameter, a field, a variable's annotation — and something calls
// `materialize` there. A `null` or `undefined` literal takes its type from
// where it sits instead, so a signature arriving that way was laid out by
// nobody: the annotation's type id had a layout and the union member's id,
// which is a second id for the same written signature, did not. The C backend
// refused the whole function with `NTS2006 an object type with no layout`,
// naming the type rather than the literal that produced it.
//
// The shapes that already worked and are here as controls: the same union as a
// **parameter**, as a **field**, and built by assignment into a `let` rather
// than by a conditional. Each of those consults a declaration, which is why
// they lowered while the conditional did not — and a fix that only made the
// conditional work would have to leave them alone.

function twice(x: number): number {
  return x * 2;
}

/** The shape that refused: a conditional whose other arm is `undefined`. */
export function chosenInline(n: number): number {
  const g: ((x: number) => number) | undefined = n > 0 ? (x) => x * 2 : undefined;
  return g === undefined ? -1 : g(n);
}

/** The same, with a **named** function rather than an arrow. A declaration
 *  used as a value is a different lowering — `ClosureStatic` — and it reaches
 *  the same union member type. */
export function chosenNamed(n: number): number {
  const g: ((x: number) => number) | undefined = n > 0 ? twice : undefined;
  return g === undefined ? -1 : g(n);
}

/** `null` rather than `undefined`. A pointer has one spare value and these are
 *  two literals for it, so both reach `lower_absent` and only the `OpKind`
 *  differs. */
export function chosenOrNull(n: number): number {
  const g: ((x: number) => number) | null = n > 0 ? (x) => x + 1 : null;
  return g === null ? -1 : g(n);
}

/** Called through an optional chain instead of a guard, so the absent arm is
 *  read by the call rather than by a comparison. */
export function calledOptionally(n: number): number {
  const g: ((x: number) => number) | undefined = n > 0 ? (x) => x * 3 : undefined;
  return g?.(n) ?? -1;
}

/** Control: the same union as a **parameter**. Its type comes from the
 *  declaration, so this lowered before the fix and must still. */
export function throughAParameter(n: number, g: ((x: number) => number) | undefined): number {
  return g === undefined ? -1 : g(n);
}

/** Control: reached through `throughAParameter`, so the union above is
 *  something the differential can drive. */
export function passesAFunction(n: number): number {
  return throughAParameter(n, n > 0 ? twice : undefined);
}

class Holder {
  g: ((x: number) => number) | undefined = undefined;
}

/** Control: the same union as a **field**, which the class's layout declares. */
export function throughAField(n: number): number {
  const h = new Holder();
  if (n > 0) {
    h.g = (x) => x * 4;
  }
  return h.g === undefined ? -1 : h.g(n);
}

/** Control: built by assignment into a `let` rather than by a conditional
 *  expression, which is the same union arriving from an annotation. */
export function assignedNotChosen(n: number): number {
  let g: ((x: number) => number) | undefined;
  if (n > 0) {
    g = (x) => x * 5;
  }
  return g === undefined ? -1 : g(n);
}

/** Two branches, both functions and neither absent — the arm that says the
 *  fix is about the absent literal and not about conditionals. */
export function chosenBetweenTwo(n: number): number {
  const g: (x: number) => number = n > 0 ? (x) => x * 2 : (x) => x + 1;
  return g(n);
}
