// `parseInt`'s radix is `ToInt32(radix)`, so `ToNumber` first: `false` is 0,
// "decide from the text", and `true` is 1, which no radix is, so NaN. Test262
// passes `false` (built-ins/parseInt/S15.1.2.2_A3.1_T1); unchecked JavaScript
// passes anything. A boolean reached the runtime's `double` unconverted, which
// C promoted by luck and the JVM refused. `numericRadix` is the control.

/** @param {number} n @returns {string} */
export function booleanRadix(n) {
  const text = String(11 + (n & 3));
  return [parseInt(text, false), parseInt(text, true), parseInt("0x1f", false), parseInt(text, "8")].join(",");
}

/** @param {number} n @returns {string} */
export function numericRadix(n) {
  const text = String(11 + (n & 3));
  return [parseInt(text, 0), parseInt(text, 1), parseInt("0x1f", 0), parseInt(text, 8)].join(",");
}
