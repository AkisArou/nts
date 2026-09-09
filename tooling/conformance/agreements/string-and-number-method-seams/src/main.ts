// The string and number methods node's own modules lean on. Each answers a
// number so only a scalar crosses.

/** toFixed rounds half away from zero on the decimal string, not the double. */
export function toFixedRounding(): number {
  return (1.005).toFixed(2) === "1.00" ? 1 : 0;
}

/** toFixed of a value that is exactly representable. */
export function toFixedExact(): number {
  return (2.5).toFixed(0).length;
}

/** parseInt stops at the first non-digit. */
export function parseIntStops(): number {
  return parseInt("12abc", 10);
}

/** parseInt with a radix reads the digits of that radix. */
export function parseIntRadix(): number {
  return parseInt("ff", 16);
}

/** parseFloat accepts an exponent. */
export function parseFloatExponent(): number {
  return parseFloat("1e3");
}

/** Number of a whitespace-only string is zero, not NaN. */
export function numberOfBlank(): number {
  const n = Number("   ");
  return n === 0 ? 1 : 0;
}

/** padStart pads to a total length, not by a count. */
export function padStartTotal(): number {
  return "7".padStart(3, "0").length;
}

/** repeat with zero gives an empty string. */
export function repeatZero(): number {
  return "ab".repeat(0).length;
}

/** split with an empty separator gives code units. */
export function splitEmpty(): number {
  return "abc".split("").length;
}

/** split with a limit stops early. */
export function splitLimit(): number {
  return "a,b,c".split(",", 2).length;
}

/** indexOf of an empty string is 0, and lastIndexOf is the length. */
export function emptyNeedle(): number {
  const s = "abc";
  return s.indexOf("") * 10 + s.lastIndexOf("");
}

/** slice clamps rather than throwing. */
export function sliceClamps(): number {
  return "abc".slice(1, 99).length;
}

/** charAt past the end gives an empty string. */
export function charAtPastEnd(): number {
  return "abc".charAt(9).length;
}

/** toUpperCase on a character with a multi-character upper form. */
export function sharpS(): number {
  return "ß".toUpperCase().length;
}
