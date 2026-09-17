// `typeof null` and `typeof undefined`, written out.
//
// Both are constants -- `"object"` and `"undefined"`, the first being the
// language's oldest quirk -- and both were refused as ``null` or `undefined`
// where what it stands in for is not a reference`: a sentence about storage, for
// an expression with no storage and a known answer.
//
// The refusal came from *lowering the operand*, which the general `typeof` path
// does before consulting the value's representation. A bare `null` has none to
// lower into. Answering from the checker's type instead skips nothing: `typeof`
// evaluates its operand, and the operand here is a keyword with no effects to
// run.
//
// **`typeof x` where `x` is a `const` holding `null` is still refused**, and so
// is `typeof g()` where `g` returns `null`. Those are the null-representation
// family -- 69 distinct sites in the corpus and the fourth-largest cause -- and
// nothing here touches it. What landed is the literal, which is the case that
// had a constant answer all along.

export function bothLiterals(n: number): string {
  return typeof null + "|" + typeof undefined;
}

/** Beside the primitives, which answered from the same table already. */
export function everySpelling(n: number): string {
  return (
    typeof null +
    "|" +
    typeof undefined +
    "|" +
    typeof n +
    "|" +
    typeof "s" +
    "|" +
    typeof true
  );
}

/** In a comparison, which is how the construct is actually written. */
export function compared(n: number): number {
  return (typeof null === "object" ? 1 : 0) + (typeof undefined === "undefined" ? 10 : 0) + n;
}

/** The nullable and optional cases, which read a run-time tag and already
 *  worked. They are here so that answering the literal from the type cannot
 *  have quietly taken over the path that must not use it. */
export function fromAValue(n: number): string {
  const s: string | null = n > 2 ? "x" : null;
  const o: { a: number } | undefined = n > 3 ? { a: n } : undefined;
  return typeof s + "|" + typeof o;
}
