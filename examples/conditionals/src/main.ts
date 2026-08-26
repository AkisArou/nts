// A ternary is an `if` that produces a value, so it lowers to the same merge
// block -- with a parameter for the value as well as for any name the two arms
// disagree about.
export function sign(x: number): number {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
}

export function pick(flag: boolean, a: number, b: number): number {
  return flag ? a : b;
}

// `||` and `&&` must not evaluate their right operand unless the left one
// requires it, and they do not produce booleans: `0 || 42` is `42`, and
// `5 || 42` is `5`.
export function orDefault(x: number): number {
  return x || 42;
}

export function andThen(x: number, y: number): number {
  return x && y;
}

export function both(a: boolean, b: boolean): boolean {
  return a && b;
}

// Truthiness is not `!= 0`: NaN is falsy, and every comparison against NaN is
// false including the inequality. `-0` is falsy too.
export function isTruthy(x: number): boolean {
  return x ? true : false;
}
