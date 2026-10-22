// `String(n)` in radix 10: the shortest digits that read back as the double,
// placed by ECMAScript's Number::toString -- fixed below 1e21 and from 1e-6,
// an exponent outside -- through every sink that formats a number: `String`,
// a template, `+` and `join`.
//
// The powers of two are where an exact algorithm that is not shortest goes
// wrong: their lower neighbour is half as far away as the upper, and QuickJS's
// `js_dtoa` writes `2^-1007` as `7.2911220195563975e-304`, seventeen digits,
// where node writes the sixteen that read back, `7.291122019556398e-304`.

const values: number[] = [
  -0,
  0,
  5e-324,
  1.7976931348623157e308,
  1e21,
  999999999999999900000,
  123456789012345680000,
  1e-7,
  -1e-7,
  1.234e-7,
  1e-6,
  0.000001234,
  0.1 + 0.2,
  9007199254740991,
  9007199254740992,
  9007199254740994,
  4.35,
  1e300,
  Math.pow(2, -1007),
  -Math.pow(2, -957),
  Math.pow(2, 70),
  NaN,
  Infinity,
  -Infinity,
  1e16,
  1.5,
  -2.5e-10,
];

function at(seed: number): number {
  return values[((seed | 0) & 255) % values.length];
}

export function written(seed: number): string {
  return String(at(seed));
}

export function inTemplate(seed: number): string {
  return `[${at(seed)}]`;
}

export function concatenated(seed: number): string {
  return "n=" + at(seed);
}

export function joined(seed: number): string {
  const start = ((seed | 0) & 255) % values.length;
  return values.slice(start, start + 4).join(",");
}

export function aFraction(seed: number): string {
  return String((seed | 0) / 7) + " " + String(((seed | 0) % 1000) * 1e-9);
}
