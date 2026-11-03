/*---
description: Partial and complete parsers distinguish nonnumeric suffixes from nonnumeric starts in a typed tuple.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-tuples]
---*/
// All four number parsers read one tuple text slot; node preserves valid integer/float prefixes before px, NUL, surrogates and other tails, but whole conversion and invalid starts fail.
function consume(input: [string, string]): number[] { const text = input[1]; return [parseInt(text), parseFloat(text), Number(text), +text]; }
const rows: [string, number, number][] = [["12", 12, 12], ["12.75", 12, 12.75], [".5", NaN, 0.5], ["5.", 5, 5], ["12e3", 12, 12000]];
for (const [body, integer, fraction] of rows) for (const sign of ["", "+", "-"]) for (const tail of ["px", "\u0000", "\u00a0x", "\ud800", "_", "x12"]) {
  const text = sign + body + tail, input: [string, string] = ["numeric", text], factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, NaN, NaN], text);
  assert.compareArray(input, ["numeric", text]);
  const invalid: [string, string] = ["numeric", tail + sign + body];
  assert.compareArray(consume(invalid), [NaN, NaN, NaN, NaN], invalid[1]);
}
