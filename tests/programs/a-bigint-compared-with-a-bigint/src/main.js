// The control for `tests/programs/a-bigint-compared-with-a-symbol`: the right
// operand is a `bigint`. It differs in one thing, that operand's type, and
// agrees with node on every backend.

/** @param {number} n @returns {number} */
export function bigintIsNotAnotherBigint(n) {
  return (0n === 1n ? 1 : 0) + n;
}
