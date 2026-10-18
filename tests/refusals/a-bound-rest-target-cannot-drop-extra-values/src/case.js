/** @param {...number} values @returns {number} */
function target(...values) { return values.length; }
/** @param {number} n @returns {number} */
export function subject(n) { const bound = target.bind(null, n); return bound(); }
