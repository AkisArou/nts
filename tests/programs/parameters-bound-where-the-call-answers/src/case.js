// Where a parameter pattern's TypeError goes: to the call, or to the promise
// the call answers. Unchecked JavaScript, as test262 is.
//
// The specification binds a function's parameters (FunctionDeclarationInstan-
// tiation) at the call, before its body runs. A **generator** -- and an
// `async` generator -- does so before its generator object exists, so a
// pattern destructuring `null` throws at the call, synchronously. An `async`
// **function** does it inside the call its promise answers, so the same
// TypeError rejects that promise and the call returns normally.
//
// Two defects, one question. A generator *method*'s raising copy -- the one a
// call inside `try` names, which is every `assert.throws` -- lost the
// parameter entry that binds at the call, so it bound at the first `next()`
// and nothing was thrown; an `async` generator had no entry at all. And an
// `async` function bound its parameters before allocating its promise, so the
// TypeError reached `nts_uncaught` and ended the program.
//
// Controls: an ordinary method (throws at the call, always did), a generator
// *function* (its entry always worked), and an `async` body's own `throw`
// (rejects, always did). Each arm answers 1 for no throw, 2 for a TypeError
// thrown at the call, 3 for a call that returned a promise.

class C {
  *generator({}) {}
  static *staticGenerator({}) {}
  async *asyncGenerator({}) {}
  async asynchronous({}) {}
  ordinary({}) {}
}
const literal = { *generator({}) {} };
function* generatorFunction({}) {}
const asyncArrow = async ({}) => {};
async function bodyThrows() { throw new TypeError("body"); }
const c = new C();

/** @param {unknown} error @returns {number} */
function thrown(error) { return error instanceof TypeError ? 2 : 9; }

/** @param {number} n @returns {number} */
export function generatorMethod(n) {
  try { c.generator(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function staticGeneratorMethod(n) {
  try { C.staticGenerator(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function objectGeneratorMethod(n) {
  try { literal.generator(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function asyncGeneratorMethod(n) {
  try { c.asyncGenerator(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function asyncMethod(n) {
  try { c.asynchronous(null).catch(() => {}); return 3 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function asyncArrowFunction(n) {
  try { asyncArrow(null).catch(() => {}); return 3 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function ordinaryMethodControl(n) {
  try { c.ordinary(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function generatorFunctionControl(n) {
  try { generatorFunction(null); return 1 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
/** @param {number} n @returns {number} */
export function asyncBodyControl(n) {
  try { bodyThrows().catch(() => {}); return 3 + (n & 0); } catch (e) { return thrown(e) + (n & 0); }
}
