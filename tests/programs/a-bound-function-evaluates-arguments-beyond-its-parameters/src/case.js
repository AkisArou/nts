// A bound argument is evaluated once even when the target ignores it.
// The sibling control differs only by declaring the ignored parameter.
// Exact 188dcc3f3: lowering panics before either C or JVM can emit it,
// lower.rs:31973:28, fields[2 + at], len 2 / index 2.
let calls = 0;
function argument() { calls += 1; return 7; }
function target() { return 11; }
/** @param {number} n @returns {number} */
export function test(n) {
  const before = calls;
  const bound = target.bind(null, argument());
  return bound() + 100 * (calls - before) + n;
}


let order = 0;
/** @param {number} value @returns {number} */
function mark(value) { order = order * 10 + value; return value; }
function noParameters() { return 11; }
/** @param {number} value @returns {number} */
function oneParameter(value) { return value + 10; }
/** @param {number} first @param {number} second @returns {number} */
function twoParameters(first, second) { return first * 10 + second; }

/** @param {number} n @returns {number} */
export function orderedAndOnce(n) {
  order = 0;
  const bound = noParameters.bind(mark(1), mark(2), mark(3));
  const atBind = order;
  const total = bound() + bound();
  return atBind * 1000000 + order * 1000 + total + n;
}

/** @param {number} n @returns {number} */
export function declaredThenExtra(n) {
  order = 0;
  const bound = oneParameter.bind(null, mark(2), mark(3), mark(4));
  const atBind = order;
  return atBind * 1000000 + bound() * 1000 + order + n;
}

// Binding one of two parameters leaves the second for the eventual call.
/** @param {number} n @returns {number} */
export function remainsUnbound(n) {
  order = 0;
  const bound = twoParameters.bind(null, mark(1));
  const atBind = order;
  const first = bound(mark(2));
  const second = bound(mark(3));
  return atBind * 1000000 + first * 10000 + second * 100 + order + n;
}

/** @param {number} n @returns {number} */
function throwingArgument(n) {
  mark(7);
  if (n > 0) throw n;
  mark(8);
  return 9;
}
/** @param {number} n @returns {number} */
export function aThrowingExtra(n) {
  order = 0;
  try {
    const bound = noParameters.bind(null, throwingArgument(n), mark(9));
    return bound() + order * 100;
  } catch (caught) {
    return order * 100 + (caught === n ? 1 : -1);
  }
}

/** @param {number} n @returns {number} */
export function discardedAbsence(n) {
  order = 0;
  const target = () => 17;
  const bound = target.bind(null, undefined, null, void mark(4));
  return bound() * 100 + order + n;
}
