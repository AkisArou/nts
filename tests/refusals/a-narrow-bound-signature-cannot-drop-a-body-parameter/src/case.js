/** @param {number} value @returns {number} */
function target(value = 7) { return value; }
/** @param {number} n @returns {number} */
export function subject(n) {
  /** @type {() => number} */
  const narrowed = target;
  const bound = narrowed.bind(null, n);
  return bound();
}
