var callCount = 0;
var f = function ([]) { callCount = callCount + 1; };
/** @param {number} n @returns {number} */
export function probe(n) {
  f([1, 2]);
  return callCount + n;
}
