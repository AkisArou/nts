// How numbers turn into strings, which node's modules do constantly and which
// has more specified corners than any other conversion. Each answers a number.
//
// **Twelve of twelve agree, and nothing here is refused.** The only case file
// in this directory with no disagreement and no refusal: radix 16, radix 16 of
// a fraction, radix 2, radix 36, a negative number in a radix conversion, an
// integer-valued double printing without a point, 1e20 printing in full, 1e21
// crossing to exponent form, 1e-7 crossing the other way, Infinity, NaN, and
// negative zero printing without its sign.
//
// Kept as a guard rather than deleted. This is the surface every `${n}` in
// `runtime/node` sits on, and the exponent thresholds in particular are the
// kind of thing that is right until an optimisation touches the formatter.

/** toString with a radix. */
export function radix16(): number {
  return (255).toString(16).length;
}

/** A radix-16 string of a value with a fractional part. */
export function radix16Fraction(): number {
  return (0.5).toString(16).length;
}

/** Radix 2 of a small integer. */
export function radix2(): number {
  return (5).toString(2).length;
}

/** Radix 36, the largest. */
export function radix36(): number {
  return (35).toString(36) === "z" ? 1 : 0;
}

/** A negative number keeps its sign in a radix conversion. */
export function radixNegative(): number {
  return (-255).toString(16).length;
}

/** An integer-valued double prints without a decimal point. */
export function integerValuedDouble(): number {
  const n = 3.0;
  return `${n}`.length;
}

/** A very large integer prints in full, not in exponent form. */
export function largeInteger(): number {
  return (1e20).toString().length;
}

/** Just past the exponent threshold. */
export function pastTheThreshold(): number {
  return (1e21).toString().length;
}

/** A very small number crosses to exponent form. */
export function verySmall(): number {
  return (1e-7).toString().length;
}

/** Infinity and its sign. */
export function infinityPrints(): number {
  const n = 1 / 0;
  return `${n}`.length;
}

/** NaN prints as NaN. */
export function nanPrints(): number {
  const n = 0 / 0;
  return `${n}`.length;
}

/** Negative zero prints without the sign. */
export function negativeZeroPrints(): number {
  const z = -0;
  return `${z}`.length;
}
