export const cases = [
  { call: "shortestRoundTrip", why: "Grisu against V8's shortest round-trip" },
  { call: "floatSumDigits", why: "0.1 + 0.2 printing exactly as node prints it" },
  { call: "bitwiseOnALargeDouble", why: "int32 coercion in a bitwise operator" },
  { call: "shiftMasking", why: "a shift count masked by 31" },
  { call: "unsignedShift", why: "unsigned shift producing a value above int32" },
  { call: "negativeRemainder", why: "the sign of a remainder" },
  { call: "astralLength", why: "string length in UTF-16 code units" },
  { call: "highSurrogate", why: "charCodeAt on a surrogate pair" },
  { call: "nanCompare", why: "NaN compared with itself" },
  { call: "negativeZero", why: "negative zero surviving as itself" },
];
