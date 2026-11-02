/*---
description: "A readonly tuple carries text and its position into parseFloat longest-prefix grammar."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-type-aliases, ts-tuples, ts-readonly]
---*/
// The readonly tuple supplies text before parseFloat; the ordered log and retained numbers distinguish complete exponents, incomplete exponents and dots. Node takes the longest valid decimal prefix.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: string[] = [
  "", " ", "+", "-", ".",
  "+.", "-.", ".5tail", "-.5tail", "1.tail",
  "1.e2tail", "1e", "1e+", "1e-", "1e+2tail",
  "1e-2tail", "1.25e2tail", "1.2.3", "1_000", "12\n34",
  "0x10", "-0Xf", "0b10", "+0o7", "NaNtail",
];
const expected: number[] = [
  NaN, NaN, NaN, NaN, NaN, NaN, NaN, 0.5,
  -0.5, 1, 100, 1, 1, 1, 100, 0.01,
  125, 1.2, 1, 12, 0, -0, 0, 0,
  NaN,
];
const log: unknown[] = [], wanted: unknown[] = [];
type TextRoute = readonly [index: number, text: string];
function consume(route: TextRoute): number {
  const index = route[0], text = route[1]; same(text, inputs[index]); same(route[0], index);
  const value: number = parseFloat(text); same(value, expected[index]);
  log.push("tuple", index, text, value); return value;
}
const retained: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const route: TextRoute = [index, inputs[index]]; same(route[0], index); same(route[1], inputs[index]);
  const value = consume(route); same(value, expected[index]); retained.push(value);
  wanted.push("tuple", index, inputs[index], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
