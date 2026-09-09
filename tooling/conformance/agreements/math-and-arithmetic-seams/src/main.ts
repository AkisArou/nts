// Math and arithmetic corners. Each answers a number.

/** Math.round rounds half up, including for negatives. */
export function roundHalfUp(): number {
  return Math.round(-0.5) === 0 ? 1 : 0;
}

/** Math.round of a positive half goes up. */
export function roundPositiveHalf(): number {
  return Math.round(2.5);
}

/** Math.trunc towards zero, both signs. */
export function truncTowardsZero(): number {
  return Math.trunc(-1.7) * 10 + Math.trunc(1.7);
}

/** Math.floor and ceil of negatives. */
export function floorCeilNegative(): number {
  return Math.floor(-1.5) * 10 + Math.ceil(-1.5);
}

/** Math.sign of negative zero is negative zero. */
export function signOfNegativeZero(): number {
  return 1 / Math.sign(-0) === -Infinity ? 1 : 0;
}

/** Math.max of no arguments is -Infinity. */
export function maxOfNothing(): number {
  return Math.max() === -Infinity ? 1 : 0;
}

/** Math.min with a NaN is NaN. */
export function minWithNaN(): number {
  const n = Math.min(1, 0 / 0);
  return n === n ? 0 : 1;
}

/** Math.abs of the most negative safe integer. */
export function absLarge(): number {
  return Math.abs(-9007199254740991) === 9007199254740991 ? 1 : 0;
}

/** Integer division by zero is Infinity, not an error. */
export function divideByZero(): number {
  const n = 1 / 0;
  return n === Infinity ? 1 : 0;
}

/** Zero divided by zero is NaN. */
export function zeroOverZero(): number {
  const n = 0 / 0;
  return n === n ? 0 : 1;
}

/** Exponentiation is right-associative. */
export function exponentAssociativity(): number {
  return 2 ** 3 ** 2;
}

/** Math.pow of a negative base and a fractional exponent is NaN. */
export function powNegativeFractional(): number {
  const n = Math.pow(-8, 1 / 3);
  return n === n ? 0 : 1;
}
