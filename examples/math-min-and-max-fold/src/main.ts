// `Math.max(a, b, c)`, `Math.max(a)` and `Math.max()`.
//
// Only the two-argument call lowered; everything else was `an intrinsic call
// with this many arguments`. The refusal's own comment named the fix -- "`Math
// .min()` is `Infinity` and `Math.min(a, b, c)` folds, but both are shapes this
// lowering does not accept yet" -- and said why it refused instead of guessing:
// "quietly producing the two-argument answer for a three-argument call would be
// wrong in a way nothing downstream could detect".
//
// **Folding is exact here, and that is the whole argument.** Each step selects
// one of its operands, so three arguments folded pairwise give the number the
// specification's n-ary comparison gives. `String.fromCharCode` folds for the
// same reason and `Math.hypot` does not, which its own comment states:
// `sqrt(sqrt(a^2+b^2)^2+c^2)` is the same number only in arithmetic that has no
// rounding.
//
// Two arms exist to make "exact" checkable rather than asserted. `-0` and `NaN`
// are where a fold could differ from an n-ary comparison and do not:
// `Math.max(-0, 0)` is `+0`, and a `NaN` anywhere makes the whole call `NaN`.

export function three(a: number, b: number): number {
  return Math.max(a, b, 3);
}

export function four(a: number, b: number): number {
  return Math.min(a, b, 3, -4);
}

export function one(a: number): number {
  return Math.max(a);
}

/** The identity of the fold, which is what the specification says an empty call
 *  answers. */
export function none(a: number): number {
  return Math.max() + a * 0;
}

export function noneMin(a: number): number {
  return Math.min() + a * 0;
}

/** The arity that always worked, so the fold cannot have changed it. */
export function two(a: number, b: number): number {
  return Math.max(a, b);
}

/** `1 / x` is how `-0` is told from `+0`: the two divide to `-Infinity` and
 *  `+Infinity`. `Math.max(-0, 0)` is `+0` and a fold has to keep it. */
export function negativeZero(a: number): number {
  return 1 / Math.max(-0, 0, a * 0);
}

/** `NaN` anywhere makes the whole call `NaN`, and a fold has to carry it
 *  through every step rather than out of the last one. */
export function nanPropagates(a: number): number {
  const x = Math.max(a, NaN, 3);
  return x !== x ? 1 : 0;
}

/** Nested, so the inner fold's result is an operand of the outer one. */
export function nested(a: number, b: number): number {
  return Math.min(Math.max(a, b, 1), Math.max(b, 2, 3));
}
