// The control for `tests/outcomes/a-generator-passed-to-an-array-pattern-parameter`:
// the same parameter pattern, `[,]`, given an array. It differs in one thing,
// the argument, and agrees with node on every backend.

function skip([,]) {
  return 1;
}

/** @param {number} n @returns {number} */
export function patternOverAnArray(n) {
  return skip([7]) + n;
}
