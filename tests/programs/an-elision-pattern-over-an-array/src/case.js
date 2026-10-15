var callCount = 0;
var f = function ([,]) { callCount = callCount + 1; };
f([1, 2]);
/** @param {number} n @returns {number} */
export function probe(n) { return callCount + n; }
