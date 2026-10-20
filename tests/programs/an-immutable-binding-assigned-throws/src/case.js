// An assignment to a binding no assignment may change throws `TypeError` --
// "Assignment to constant variable." -- once its right side has run, in strict
// code, which a module's is. Unchecked JavaScript, as test262 is.
//
// A `const` was refused ("assigning to a `const`"); one held as a module
// global was written as if it were a `let`; and a function expression's own
// name -- immutable inside its body -- was rebound to the assigned number and
// read back as the function. Each arm answers 1 for no throw, 2 for a
// TypeError caught where node catches it, and adds 10 when the right side ran.
//
// The control is a `let`, which takes the assignment.

const atModuleScope = 1;
let sideEffects = 0;
function bump() { sideEffects = sideEffects + 1; return 2; }

/** @param {() => void} run @returns {number} */
function attempt(run) {
  sideEffects = 0;
  let answer = 1;
  try { run(); } catch (error) { answer = error instanceof TypeError ? 2 : 9; }
  return answer + (sideEffects > 0 ? 10 : 0);
}

const named = function Named() { Named = bump(); return typeof Named; };

/** @param {number} n @returns {number} */
export function localConst(n) {
  return attempt(() => { const fixed = 1; fixed = bump(); }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function moduleConst(n) {
  return attempt(() => { atModuleScope = bump(); }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function compoundConst(n) {
  return attempt(() => { const fixed = 1; fixed += bump(); }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function incrementedConst(n) {
  return attempt(() => { const fixed = 1; fixed++; }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function destructuredConst(n) {
  return attempt(() => { const fixed = 1; [fixed] = [bump()]; }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function functionExpressionName(n) {
  return attempt(() => { named(); }) + (n & 0);
}
/** @param {number} n @returns {number} */
export function letControl(n) {
  return attempt(() => { let open = 1; open = bump(); }) + (n & 0);
}
