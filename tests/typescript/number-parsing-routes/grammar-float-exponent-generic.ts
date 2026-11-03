/*---
description: parseFloat commits complete exponents and rolls back incomplete ones through a constrained generic text parameter.
features: [ts-number-parsing-routes, ts-number-parsing-route-grammar, ts-numbers, ts-strings, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-generics, ts-generic-constraints, ts-objects, ts-tuples]
---*/
// parseFloat reads a generic text field; node keeps complete e/E exponents, rolls incomplete ones back to the mantissa and stops at later punctuation.
function consume<T extends { text: string }>(input: T): number { return parseFloat(input.text); }
const mantissas: [string, number, number][] = [["1", 1, 1], [".5", 5, 10], ["5.", 5, 1], ["12.5", 125, 10]];
const exponents: [string, number, number][] = [
  ["", 1, 1], ["e3", 1000, 1], ["E+3", 1000, 1], ["e-3", 1, 1000], ["e+0003", 1000, 1], ["E-0003", 1, 1000],
  ["e", 1, 1], ["e+", 1, 1], ["E-", 1, 1], ["e+z", 1, 1], ["e-_9", 1, 1],
  ["e+2_3", 100, 1], ["e+2.5", 100, 1], ["e+2e4", 100, 1]
];
for (const [body, integer, scale] of mantissas) for (const [exponent, numerator, denominator] of exponents) for (const sign of ["", "+", "-"]) {
  const text = sign + body + exponent, input = { marker: "decimal", text }, factor = sign === "-" ? -1 : 1;
  assert.sameValue(consume(input), factor * (integer * numerator / (scale * denominator)), text);
  assert.sameValue(input.text, text);
}
