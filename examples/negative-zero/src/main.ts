// `-0` and `0` are different doubles and the same integer, so a value that might
// be `-0` cannot be represented as one -- unless nothing can tell which it was.
// Working out when that is safe is what `hir::zero_sign` does, and getting it
// wrong is not a crash: it is `+Infinity` where a program said `-Infinity`.
//
// Every function here is a way the sign can escape. `nts check` runs all of them
// against node over a pool that includes both zeros and both signs, which is the
// only reason to believe the analysis.

// Dividing by it is how the sign is seen. `0 * -5` is `-0`, so this is
// `-Infinity` and not `+Infinity`.
export function divideByProduct(a: number, b: number): number {
  return 1 / (a * b);
}

// Negation carries the sign: `-0` is `0` negated.
export function divideByNegation(a: number): number {
  return 1 / -a;
}

// `Math.min(0, -0)` is `-0`, which is the one place min and max are not just
// comparisons.
export function minOfProduct(a: number, b: number): number {
  return Math.min(a * b, 0);
}

// Leaving the function: what the caller does with it is not visible here.
export function returnsProduct(a: number, b: number): number {
  return a * b;
}

// And the case the analysis exists to allow: a coercion carries nothing back,
// so the product may be an integer however many negative zeros it passes
// through.
export function coercedProduct(a: number, b: number): number {
  return (a * b) | 0;
}

// The same question across a loop, where the accumulator is a block parameter
// and the sign has to be carried back along the edge.
export function accumulateThenDivide(n: number, k: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = total + i * k;
  }
  return 1 / total;
}

export function accumulateThenCoerce(n: number, k: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) {
    total = (total + i * k) | 0;
  }
  return total;
}
