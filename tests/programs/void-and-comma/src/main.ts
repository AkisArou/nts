// `void e` and `a, b`, both refused until 2026-09-12.
//
// Neither is arithmetic, and that is why neither had a place in the tables that
// refused them.
//
// `void e` evaluates its operand and answers `undefined`. The operand's *type*
// does not reach the result — `void 0` is `undefined`, not a number — and the
// operand is still lowered, because `void f()` calls `f`. Not folded away even
// where it can have no effect: deciding that is dead-code elimination's job and
// it already does it, and this lowering stating "the value is discarded" is the
// whole of what `void` means.
//
// `a, b` **sequences** rather than combines. It reached `lower_binary`'s
// operator table and was refused as `the operator a comma token`, which is true
// and is the wrong question: there is no result of `a` for an operator to be
// applied to. So it is handled before that table rather than given a `BinOp` it
// could never have had.
//
// # The controls are the effects
//
// Every case here counts a side effect as well as reading the value, because
// both operators are *about* evaluation order. A `void` that folded its operand
// away, or a comma that dropped its left, would answer the same value and a
// different count — and a fixture reading only the value could not tell.

let effects = 0;

function bump(n: number): number {
  effects += n;
  return effects;
}

/** Under test: `void` of a call. The call happens; the value does not survive. */
export function voidOfACall(n: number): number {
  effects = 0;
  const v = void bump(n & 7);
  return (v === undefined ? 1 : 0) * 100 + effects;
}

/** Under test: `void 0`, the idiom — `undefined`, not the operand's type. */
export function voidZero(n: number): number {
  const v = void 0;
  return v === undefined ? (n & 7) : 0;
}

/** Under test: the comma, with both sides observable. */
export function commaSequences(n: number): number {
  effects = 0;
  const r = (bump(n & 7), bump(1));
  return r * 100 + effects;
}

/**
 * Under test: a comma in a `for` update clause, which is where JavaScript
 * actually writes one — two names advancing together.
 */
export function commaInAFor(n: number): number {
  let a = 0;
  let b = 0;
  for (let i = 0; i < (n & 3); i++, a++) b += a;
  return a * 10 + b;
}

/** Under test: nested, so the left of one comma is another. */
export function commaChained(n: number): number {
  effects = 0;
  const r = (bump(1), bump(2), bump(n & 3));
  return r * 100 + effects;
}
