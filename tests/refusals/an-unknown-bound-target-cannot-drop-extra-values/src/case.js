/** @param {() => number} target */
export function bindUnknown(target) { return target.bind(null, 7); }
function first() { return 11; }
function second() { return 12; }
/** @param {number} n @returns {number} */
export function subject(n) { return bindUnknown(n > 0 ? first : second)(); }
