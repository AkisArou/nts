/*---
description: "Table control for partial-int-decimal-parameter; A typed string parameter reaches decimal parseInt before a declared numeric return and retained array read."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings]
---*/
// The string parameter is checked before decimal partial parsing; the log records text and result. Node preserves signed zero, stops at the first non-digit and returns NaN without a leading digit. The control keeps the route and substitutes position-indexed literal results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: string[] = [
  "", " ", "+", "-", "0",
  "-0", "+0rest", "-000rest", "12tail", "-12.75tail",
  "+12.75tail", "1e3tail", "1_000", ".5tail", "-.5tail",
  "+ 1", "--1", "+-1", "12 34", "12\n34",
  "0x10", "-0Xf", "0b11", "Infinity", "NaN",
  "\uff11\uff12",
];
const expected: number[] = [
  NaN, NaN, NaN, NaN, 0, -0, 0, -0,
  12, -12, 12, 1, 1, NaN, NaN, NaN,
  NaN, NaN, 12, 12, 0, -0, 0, NaN,
  NaN, NaN,
];
const log: unknown[] = [], wanted: unknown[] = [];
const retained: number[] = [];
function consume(text: string, index: number): number {
  same(text, inputs[index]); const value: number = expected[index];
  same(value, expected[index]); log.push("decimal", index, text, value); return value;
}
for (let index = 0; index < inputs.length; index++) {
  const value: number = consume(inputs[index], index); retained.push(value); same(value, expected[index]);
  wanted.push("decimal", index, inputs[index], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
