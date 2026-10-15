var callCount = 0;
var iter = function* () { callCount += 10; }();
var f = function ([]) { callCount = callCount + 1; };
f(iter);
/** @param {number} n @returns {number} */
export function probe(n) { return callCount + n; }
