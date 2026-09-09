export const cases = [
  { call: "codePointAtPair", why: "codePointAt reading a whole surrogate pair" },
  { call: "fromCharCodeUnits", why: "fromCharCode building from code units" },
  { call: "nullCharacterLength", why: "a null character counted in the length" },
  { call: "comparePastNull", why: "comparing strings that differ past a null" },
  { call: "typedArrayBasics", why: "a Uint8Array's length and element read" },
  { call: "typedArrayWraps", why: "Uint8Array elements wrapping at 256" },
  { call: "typedArrayNegativeWraps", why: "a negative value wrapping into a byte" },
  { call: "charCodeAtPastEnd", why: "charCodeAt past the end being NaN" },
  { call: "normalizeIdempotent", why: "normalize leaving a composed string alone" },
];
