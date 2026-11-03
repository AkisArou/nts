/*---
description: Separators in every decimal component stop partial parsers and invalidate complete numeric conversion from a Record field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-record, ts-tuples]
---*/
// All four number parsers read a Record text field; node stops before underscores in the significand or exponent and returns NaN for every separated whole string.
function consume(input: Record<"text", string>): number[] { const text = input.text; return [parseInt(text), parseFloat(text), Number(text), +text]; }
const rows: [string, number, number, number][] = [
  ["1_000", 1, 1, NaN], ["_1000", NaN, NaN, NaN], ["10_00", 10, 10, NaN], ["1000_", 1000, 1000, NaN], ["1__000", 1, 1, NaN],
  ["1_.5", 1, 1, NaN], ["1._5", 1, 1, NaN], ["1.2_5", 1, 1.2, NaN], [".5_0", NaN, 0.5, NaN], ["._5", NaN, NaN, NaN],
  ["1e_3", 1, 1, NaN], ["1e+_3", 1, 1, NaN], ["1e3_0", 1, 1000, NaN], ["1000", 1000, 1000, 1000], ["1.25", 1, 1.25, 1.25]
];
for (const [body, integer, fraction, whole] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + body, input: Record<"text", string> = { text }, factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, factor * whole, factor * whole], text);
  assert.sameValue(input.text, text);
}
