/*---
description: Number and unary plus require complete exponent grammar from a declared string-array element.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-readonly, ts-tuples]
---*/
// Number and unary plus read the same typed array element; node accepts complete dot/exponent strings and rejects an incomplete exponent or trailing punctuation.
function consume(input: readonly string[]): number[] { const text = input[1]; return [Number(text), +text]; }
const mantissas: [string, number, number][] = [["1", 1, 1], [".5", 5, 10], ["5.", 5, 1], ["12.5", 125, 10], [".", NaN, 1]];
const exponents: [string, number, number, boolean][] = [
  ["", 1, 1, true], ["e3", 1000, 1, true], ["E+3", 1000, 1, true], ["e-3", 1, 1000, true], ["E-0003", 1, 1000, true],
  ["e", 1, 1, false], ["e+", 1, 1, false], ["E-", 1, 1, false], ["e+z", 1, 1, false], ["e-_9", 1, 1, false],
  ["e+2_3", 100, 1, false], ["e+2.5", 100, 1, false], ["e+2e4", 100, 1, false]
];
for (const [body, integer, scale] of mantissas) for (const [exponent, numerator, denominator, valid] of exponents) for (const sign of ["", "+", "-"]) {
  const text = sign + body + exponent, input: string[] = ["sentinel", text, "tail"], factor = sign === "-" ? -1 : 1;
  const expected = valid ? factor * (integer * numerator / (scale * denominator)) : NaN;
  assert.compareArray(consume(input), [expected, expected], text); assert.compareArray(input, ["sentinel", text, "tail"]);
}
