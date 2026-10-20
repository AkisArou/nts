// An `async` function's parameter default that throws: the specification
// evaluates it while binding the parameters, inside the call the function's
// promise answers (EvaluateAsyncFunctionBody), so the throw rejects that
// promise and the call returns normally. node: 3, a promise returned.
//
// nts evaluates a default in the caller -- an omitted argument is filled at
// the call site, at the parameter's own representation, which is what keeps
// a defaulted parameter cheap -- so `thrower()` runs before the async
// function is entered and its RangeError is the caller's: the program ends
// on an uncaught RangeError, though the call sits inside a `try`.
//
// A pattern's TypeError and a pattern *element*'s default are bound inside
// the callee, after its promise exists, and reject (tests/programs/parameters-
// bound-where-the-call-answers). This is the parameter-level default alone:
// making the callee own a default that can throw changes the calling
// convention -- the parameter crosses erased for the callee to bind -- and is
// its own change, with its benchmark.
//
// The control is `effectFree`: the same function with a default that cannot
// throw, which a caller may fill as it likes, and which agrees.

async function throwingDefault(x = thrower()) {}
async function effectFreeDefault(x = 1) { return x; }
function thrower() { throw new RangeError("default"); }

/** @param {number} n @returns {number} */
export function throwing(n) {
  try { throwingDefault().catch(() => {}); return 3 + (n & 0); } catch (e) { return 2 + (n & 0); }
}

/** @param {number} n @returns {number} */
export function effectFree(n) {
  try { effectFreeDefault().catch(() => {}); return 3 + (n & 0); } catch (e) { return 2 + (n & 0); }
}
