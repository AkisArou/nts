var callCount = 0;
function* g([]) { callCount = callCount + 1; }
g([1, 2]).next();
/** @param {number} n @returns {number} */
export function probe(n) { return callCount + n; }
