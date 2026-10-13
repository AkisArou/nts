// backend: jvm
// run: check
//
// Bigint exponentiation must keep integer precision, including past 2^53.
// The control changes only the base to a power of two, whose square is exact
// even if a backend goes through a double. Both results fit signed 128 bits.
// Negative exponents throw RangeError: node v24.20.0/V8 currently says
// "undefined must be positive". This is the oracle's text, not specification
// wording; a future Node version may change it.
// The pre-fix C sends both operands to nts_math_pow as doubles and casts its
// result back to __int128. Its 58 disagreements are squaredOdd and
// negativeExponent; the two controls agree (116 cases over four exports).

export function squaredOdd(v: number): string {
  const base = 9007199254740993n + BigInt((v | 0) & 7);
  return (base ** 2n).toString();
}

export function squaredPowerOfTwo(v: number): string {
  const base = 9007199254740992n + BigInt((v | 0) & 0);
  return (base ** 2n).toString();
}

export function negativeExponent(v: number): string {
  try {
    return (2n ** BigInt(-(((v | 0) & 7) + 1))).toString();
  } catch (error) {
    if (error instanceof RangeError) return error.message;
    return "unexpected error";
  }
}

export function nonnegativeExponent(v: number): string {
  return (2n ** BigInt((v | 0) & 7)).toString();
}
