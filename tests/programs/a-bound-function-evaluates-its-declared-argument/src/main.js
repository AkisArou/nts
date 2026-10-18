// Control for a-bound-function-evaluates-arguments-beyond-its-parameters.
// Only the target parameter changes; its value is still ignored.
let calls = 0;
function argument() { calls += 1; return 7; }
function target(_ignored) { return 11; }
/** @param {number} n @returns {number} */
export function test(n) {
  const before = calls;
  const bound = target.bind(null, argument());
  return bound() + 100 * (calls - before) + n;
}
