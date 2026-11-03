/*---
description: An optional tuple radix applies ToInt32 before selecting the integer digit alphabet.
features: [ts-number-parsing-routes, ts-number-parsing-route-radix, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-tuple-optional, ts-null-undefined]
---*/
// parseInt reads an optional tuple slot; node uses decimal for absent, zero or nonfinite radices, wraps large radices and rejects converted values outside 2 through 36.
function consume(input: [string, number?]): number { if (input.length === 1) return parseInt(input[0]); return parseInt(input[0], input[1]); }
const radices: [number | undefined, number][] = [
  [undefined, 11], [0, 11], [-0, 11], [1, NaN], [2, 3], [36, 37], [37, NaN], [-1, NaN], [-2, NaN],
  [0.9, 11], [-0.9, 11], [1.9, NaN], [2.9, 3], [-2.9, NaN], [16.9, 17], [36.9, 37], [37.9, NaN],
  [NaN, 11], [Infinity, 11], [-Infinity, 11], [4294967296, 11], [4294967312, 17], [-4294967280, 17],
  [4294967298, 3], [-4294967294, 3], [4294967297, NaN], [4294967295, NaN], [2147483648, NaN], [9007199254740992, 11], [9007199254740994, 3]
];
for (const padding of ["", "\t", "\u00a0"]) for (const sign of ["", "+", "-"]) {
  const text = padding + sign + "11#", factor = sign === "-" ? -1 : 1, missing: [string, number?] = [text];
  assert.sameValue(consume(missing), factor * 11, text); assert.sameValue(missing.length, 1);
  for (const [radix, expected] of radices) {
    const input: [string, number?] = [text, radix];
    assert.sameValue(consume(input), factor * expected, text); assert.sameValue(input[0], text); assert.sameValue(input[1], radix);
  }
}
