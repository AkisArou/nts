export const cases = [
  { call: "roundHalfUp", why: "Math.round of -0.5 giving -0, which is 0" },
  { call: "roundPositiveHalf", why: "Math.round of a positive half going up" },
  { call: "truncTowardsZero", why: "Math.trunc towards zero on both signs" },
  { call: "floorCeilNegative", why: "floor and ceil of a negative half" },
  { call: "signOfNegativeZero", why: "Math.sign preserving negative zero" },
  { call: "maxOfNothing", why: "Math.max of no arguments being -Infinity" },
  { call: "minWithNaN", why: "Math.min with a NaN being NaN" },
  { call: "absLarge", why: "Math.abs of the most negative safe integer" },
  { call: "divideByZero", why: "division by zero being Infinity" },
  { call: "zeroOverZero", why: "zero over zero being NaN" },
  { call: "exponentAssociativity", why: "exponentiation being right-associative" },
  { call: "powNegativeFractional", why: "a negative base with a fractional exponent" },
];
