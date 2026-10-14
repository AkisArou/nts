export const cases = [
  { call: "radix16", why: "toString with radix 16" },
  { call: "radix16Fraction", why: "radix 16 of a value with a fraction" },
  { call: "radix2", why: "radix 2 of a small integer" },
  { call: "radix36", why: "radix 36, the largest" },
  { call: "radixNegative", why: "a negative number in a radix conversion" },
  { call: "integerValuedDouble", why: "an integer-valued double printing without a point" },
  { call: "largeInteger", why: "1e20 printing in full" },
  { call: "pastTheThreshold", why: "1e21, just past the exponent threshold" },
  { call: "verySmall", why: "1e-7 crossing to exponent form" },
  { call: "infinityPrints", why: "Infinity printing" },
  { call: "nanPrints", why: "NaN printing" },
  { call: "negativeZeroPrints", why: "negative zero printing without a sign" },
];
