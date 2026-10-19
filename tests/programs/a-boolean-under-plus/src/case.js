// `true + true` is `2`. Once both operands of `+` are primitives and neither
// is a string, `+` adds their numeric values (ECMA-262 13.15.3), and a
// boolean's is `1` or `0`. The lowering left two `bool`s to `add`, which is
// invalid HIR (`OperandType`), so `emit-c` wrote nothing for the program:
// test262's `types/number/S8.5_A5` (`(x >= 0.0) + (x <= 0.0)`) and
// `expressions/addition/S11.6.1_A3.1_T1.1` (`true + true`), invalid-HIR group
// 1 of the JVM lane's census. TypeScript rejects all of these (TS2365), so
// this is JavaScript, as test262 is.
//
// The control is `numbers`: the same sums over the numbers `Number(b)` gives,
// which always compiled.

// The shape the census found: a module-scope `var` holding the sum, whose
// type the checker leaves `any`, so the `+` had no typed result to take.
var x = NaN;
var both = (x >= 0.0) + (x <= 0.0);
var twice = true + true;
var mixed = true + 1;

/** @param {number} n @returns {string} */
export function atModuleScope(n) {
  return String(both) + "," + String(twice) + "," + String(mixed) + "," + (n & 1);
}

/** @param {number} n @returns {number} */
export function booleans(n) {
  return (n > 0) + (n > 1);
}

/** @param {number} n @returns {number} */
export function booleanAndNumber(n) {
  return (n > 0) + n;
}

/** @param {number} n @returns {number} */
export function numberAndBoolean(n) {
  return n + (n < 0);
}

/** @param {number} n @returns {number} */
export function compound(n) {
  let total = n;
  total += n > 2;
  return total;
}

/** @param {number} n @returns {number} */
export function numbers(n) {
  return Number(n > 0) + Number(n > 1);
}
