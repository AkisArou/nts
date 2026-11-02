/*---
description: "Table control for partial-number-string-pipeline; A typed number parameter is explicitly converted to text before parseInt and parseFloat return interface fields."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-interfaces, ts-objects]
---*/
// A number parameter is checked before explicit String conversion; every stage and returned field is observed. Node formats small and large magnitudes exponentially, so partial integer parsing differs from floating parsing; negative zero first becomes text 0. The control keeps the route and substitutes position-indexed literal results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: number[] = [
  0, -0, 0.0000005, -0.0000005, 0.000001, 1e21, -1e21,
  1e20, -1e20, 1.5, -1.5, NaN, Infinity, -Infinity,
];
const texts: string[] = [
  "0", "0", "5e-7", "-5e-7",
  "0.000001", "1e+21", "-1e+21", "100000000000000000000",
  "-100000000000000000000", "1.5", "-1.5", "NaN",
  "Infinity", "-Infinity",
];
const integers: number[] = [
  0, 0, 5, -5, 0, 1, -1,
  1e20, -1e20, 1, -1, NaN, NaN, NaN,
];
const fractions: number[] = [
  0, 0, 0.0000005, -0.0000005, 0.000001, 1e21, -1e21,
  1e20, -1e20, 1.5, -1.5, NaN, Infinity, -Infinity,
];
const log: unknown[] = [], wanted: unknown[] = [];
interface ParsedValues { text: string; integer: number; fraction: number; }
function consume(input: number, index: number): ParsedValues {
  same(input, inputs[index]); const text = texts[index]; same(text, texts[index]); log.push("string", input, text);
  const integer = integers[index]; same(integer, integers[index]); log.push("int", integer);
  const fraction = fractions[index]; same(fraction, fractions[index]); log.push("float", fraction);
  return { text, integer, fraction };
}
const retained: ParsedValues[] = [];
for (let index = 0; index < inputs.length; index++) {
  const value = consume(inputs[index], index); retained.push(value);
  same(value.text, texts[index]); same(value.integer, integers[index]); same(value.fraction, fractions[index]);
  wanted.push("string", inputs[index], texts[index], "int", integers[index], "float", fractions[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) {
  same(retained[index].text, texts[index]); same(retained[index].integer, integers[index]); same(retained[index].fraction, fractions[index]);
}
assert.compareArray(log, wanted);
