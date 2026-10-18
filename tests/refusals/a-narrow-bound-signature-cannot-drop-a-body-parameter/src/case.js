/** @param {number} value @returns {number} */
function target(value = 7) { return value; }
/** @type {() => number} */
const narrowed = target;
/** @param {number} n @returns {number} */
export function subject(n) { const bound = narrowed.bind(null, n); return bound(); }
