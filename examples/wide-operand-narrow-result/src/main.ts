// An operation is as wide as the widest value it touches, and the result is
// only one of those.
//
// `specialize::width_of` used to read the width off the operation's own result.
// For `%` that is wrong in the systematic way: a remainder is bounded by the
// divisor however large the dividend is, so `(sum * 31 + code) % 1000000007`
// was made a 32-bit operation and the dividend -- which reaches 3.1e10 -- was
// truncated with `(int32_t)` on the way in. The answer came out **negative**.
//
// That is the ordinary polynomial hash, written the way everyone writes it.
//
// `+`, `-` and `*` reach the same shape by cancellation rather than by
// definition, and unary negation reaches it at exactly one value. Each has a
// case here, and each is checked against node rather than against a claim about
// what the arithmetic should be.

// THE CASE. `%` whose result fits `i32` and whose dividend does not.
export function hash(rounds: number): number {
  // Bounded, because the differential feeds a parameter from a pool and a
  // two-billion-iteration loop is a timeout rather than a disagreement.
  const limit = rounds > 0 && rounds < 1000 ? rounds : 64;
  let sum = 0;
  for (let index = 0; index < limit; index++) {
    sum = (sum * 31 + index) % 1000000007;
  }
  return sum;
}

// The same shape with a bigger multiplier, so the dividend leaves `i32` on the
// first iteration rather than the fifth.
export function hashWide(seed: number): number {
  return (seed * 1000003 + 7) % 1000000007;
}

// Subtraction that cancels: both operands are far outside `i32`, the difference
// is small, and the difference is what the result's range sees.
export function cancels(n: number): number {
  const high = n * 4000000000;
  const other = n * 4000000000;
  return high - other + n;
}

// Multiplication into a remainder, without an addition between them.
export function product(a: number): number {
  return (a * 3000000000) % 97;
}

// Negation of the one value whose negative does not fit the same width.
export function negate(n: number): number {
  const low = n - 2147483648;
  return -low;
}

// CONTROLS. Ordinary 32-bit arithmetic, which must stay 32-bit: a fix that
// widened everything would agree with node here too, and would be a different
// change. These are the rows `benches/cases/dispatch` and every loop counter
// depend on.
export function counter(n: number): number {
  const limit = n > 0 && n < 1000 ? n : 64;
  let total = 0;
  for (let index = 0; index < limit; index++) {
    total = total + index;
  }
  return total;
}

export function smallRemainder(n: number): number {
  return (n % 7) + (n % 13);
}

export function smallProduct(a: number): number {
  return a * 3 + 1;
}
