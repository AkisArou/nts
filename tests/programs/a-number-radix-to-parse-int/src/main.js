// The control for `tests/outcomes/a-boolean-radix-to-parse-int`: the radix is
// the number `0`, which is what `ToNumber(false)` is. It differs in one thing,
// the radix's type, and agrees with node on every backend.

/** @param {number} n @returns {number} */
export function radixZero(n) {
  return parseInt("11", 0) + n;
}
