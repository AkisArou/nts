// **Fixed 2026-10-15, and now its guard:** a strict comparison of two values whose
// checker types are of different `typeof` kinds compares them erased, and the
// erased comparison answers `false` by their tags. What it was:
//
// **`===` between a `bigint` and a symbol is one `eq` of two types.** The
// answer is `false` whatever the values, since strict equality of two
// different types is false. The prepared HIR compares them as they are:
// `eq %0, %2` with `%0 : bigint` and `%2 : managed<sym>`. The verifier
// accepts it.
//
// C agrees with node by luck: it compares two pointers, which differ. The JVM
// picks `bigint` equality from the left operand, `NtsBigInt.eq(NtsBigInt,
// NtsBigInt)`, and the class fails verification on the symbol, `VerifyError:
// Bad type on operand stack`, on every case. Test262's
// `expressions/strict-equals` and `strict-does-not-equals`
// `bigint-and-incomparable-primitive`, which pass on C.
//
// The control is `tests/programs/a-bigint-compared-with-a-bigint`, which
// differs in one thing: the right operand is a `bigint`.
//
// Found on 2026-10-15 by the JVM lane's first test262 parity run.

/** @param {number} n @returns {number} */
export function bigintIsNotASymbol(n) {
  return (0n === Symbol("1") ? 1 : 0) + n;
}
