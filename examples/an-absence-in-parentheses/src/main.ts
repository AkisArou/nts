// `(null) !== null` and `(void 0) !== void 0`, which are the same fold written
// two ways the fold could not see.
//
// `comparison_of_two_absences` answers an equality between two absences without
// lowering either, because `null` has no representation to compare. It asks
// `absence_written_at` of each side, and that function tested the node's *kind*
// for `NULL_KEYWORD` — so a `PARENTHESIZED_EXPRESSION` was not one, the fold
// declined, and the ordinary path then asked for a representation of `null` and
// refused for want of it.
//
// **Only `null` was affected, which is why it looked like a question about
// `null`.** The `undefined` branch reads the node's *text* rather than its kind,
// and a parenthesised `undefined` still spells itself — so `(undefined) !==
// undefined` lowered beside `(null) !== null` refusing, and the asymmetry
// pointed at the wrong half.
//
// Parentheses are transparent here for the same reason `place_of` unwraps them
// and `lower_expression` says "parentheses group; they compute nothing".
//
// # `void 0`, and the C that did not compile
//
// `void 0` is `undefined` written the other way. It was not folded, so both
// operands were lowered, and a `void` with no contextual type takes
// `HirType::Void` — which the C backend writes as `(void)0` and then assigns:
//
//     v57 = (void)0;     /* 'v57' undeclared; invalid use of void expression */
//
// A program that compiled and emitted C that does not, on both this binary and
// the one at 23666c14. It was reached the moment the parenthesis fix above
// stopped refusing the file one line earlier — the ordinary way a refusal hides
// the defect behind it, and the reason both fixes are in one commit.
//
// **The fold is allowed only over a literal operand.** `void` is an operator
// over an arbitrary expression and `void f()` calls `f`; `voids_a_literal` is
// that restriction, and `stillCallsTheOperand` below is the arm that fails if it
// is ever relaxed.

/** `(null)` on either side, and on both. */
export function parenthesisedNull(n: number): number {
  const a = (null) !== null ? 1 : 0;
  const b = null !== (null) ? 1 : 0;
  const c = (null) !== (null) ? 1 : 0;
  const d = ((null)) === null ? 1 : 0;
  return a * 1000 + b * 100 + c * 10 + d + n * 0;
}

/** The `undefined` half, which already worked and must keep working. */
export function parenthesisedUndefined(n: number): number {
  const a = (undefined) !== undefined ? 1 : 0;
  const b = (undefined) === undefined ? 1 : 0;
  return a * 10 + b + n * 0;
}

/** Loose equality, where the two absences are equal and strict equality says no. */
export function looseAcrossTheTwo(n: number): number {
  const a = (null) == undefined ? 1 : 0;
  const b = (null) === undefined ? 1 : 0;
  const c = (undefined) == null ? 1 : 0;
  return a * 100 + b * 10 + c + n * 0;
}

/** `void 0` against itself and against the other two spellings. */
export function voidOfALiteral(n: number): number {
  const a = (void 0) !== void 0 ? 1 : 0;
  const b = void 0 === undefined ? 1 : 0;
  const c = void 0 == null ? 1 : 0;
  const d = void "x" === undefined ? 1 : 0;
  return a * 1000 + b * 100 + c * 10 + d + n * 0;
}

/**
 * The control: `void` over a call still calls it.
 *
 * A fold that took `void <anything>` would make this arm answer 0 calls, and it
 * is the only arm here whose failure is a wrong answer rather than a refusal.
 */
export function stillCallsTheOperand(n: number): number {
  let calls = 0;
  const bump = (): number => {
    calls = calls + 1;
    return 7;
  };
  const absent = (void bump()) === undefined ? 1 : 0;
  return calls * 10 + absent + n * 0;
}

/** A parenthesised absence as a *value*, which takes its type from the `+`. */
export function concatenatedThroughParentheses(n: number): number {
  const a = "A: " + ((undefined));
  const b = "A: " + ((null));
  return a.length * 100 + b.length + n * 0;
}
