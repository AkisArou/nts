// Seams where the compiler makes a representation choice and node has already
// made one. Each answers a number so only a scalar crosses.

/** Grisu against V8's shortest round-trip. */
export function shortestRoundTrip(): number {
  return (0.1 + 0.2).toString().length;
}

/** The classic, and the answer node gives is 0.30000000000000004. */
export function floatSumDigits(): number {
  return (0.1 + 0.2).toString() === "0.30000000000000004" ? 1 : 0;
}

/** Bit operations coerce through int32 in JavaScript. */
export function bitwiseOnALargeDouble(): number {
  const big = 2147483648;
  return big | 0;
}

/** Shifts mask their right operand by 31. */
export function shiftMasking(): number {
  return 1 << 33;
}

/** Unsigned shift produces a value above int32. */
export function unsignedShift(): number {
  return -1 >>> 0;
}

/** Integer division truncation and the sign of a remainder. */
export function negativeRemainder(): number {
  return -7 % 3;
}

/** String length is UTF-16 code units, not code points. */
export function astralLength(): number {
  return "\u{1F600}".length;
}

/** charCodeAt on a surrogate pair gives the high surrogate. */
export function highSurrogate(): number {
  return "\u{1F600}".charCodeAt(0);
}

/** Comparison of a NaN with itself. */
export function nanCompare(): number {
  const n = 0 / 0;
  return n === n ? 1 : 0;
}

/** Negative zero is distinguishable only through Object.is-style tests. */
export function negativeZero(): number {
  const z = -0;
  return 1 / z === -Infinity ? 1 : 0;
}
