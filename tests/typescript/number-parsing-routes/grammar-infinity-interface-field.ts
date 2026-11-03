/*---
description: The four number parsers distinguish the exact Infinity word and its tails through one interface field.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-interfaces, ts-objects, ts-tuples]
---*/
// parseInt, parseFloat, Number and unary plus read one interface field; node rejects Infinity for integers, takes its float prefix and requires the whole word for conversion.
interface SpecialText { text: string; }
function consume(input: SpecialText): number[] { const text = input.text; return [parseInt(text), parseFloat(text), Number(text), +text]; }
const rows: [string, number, number, number][] = [
  ["Infinity", NaN, Infinity, Infinity], ["Infinity0", NaN, Infinity, NaN], ["Infinitye-2", NaN, Infinity, NaN],
  ["Infinity_", NaN, Infinity, NaN], ["Infinity.0", NaN, Infinity, NaN], ["Infinity+1", NaN, Infinity, NaN],
  ["infinity", NaN, NaN, NaN], ["INFINITY", NaN, NaN, NaN], ["InfinitY", NaN, NaN, NaN],
  ["Inf", NaN, NaN, NaN], ["NaN", NaN, NaN, NaN], ["\u221e", NaN, NaN, NaN], ["7", 7, 7, 7], ["12", 12, 12, 12]
];
for (const [body, integer, fraction, whole] of rows) for (const sign of ["", "+", "-"]) {
  const text = sign + body, input: SpecialText = { text }, factor = sign === "-" ? -1 : 1;
  assert.compareArray(consume(input), [factor * integer, factor * fraction, factor * whole, factor * whole], text);
  assert.sameValue(input.text, text);
}
