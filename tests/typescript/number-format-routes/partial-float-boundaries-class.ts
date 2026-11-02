/*---
description: "A declared string field reaches parseFloat inside a class method at infinity, subnormal and zero boundaries."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-class, ts-class-fields]
---*/
// The class method checks its original text before parsing, logs the return and keeps the source unchanged. Node returns exact infinities, signed underflow zeros, subnormals and rounded integers for the fixed decimal inputs.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
const inputs: string[] = [
  "1.7976931348623157e308tail", "1.7976931348623159e308tail", "-1.7976931348623159e308tail",
  "5e-324tail", "2e-324tail", "-2e-324tail",
  "3e-324tail", "-3e-324tail", "1e309tail",
  "-1e309tail", "1e-400tail", "-1e-400tail",
  "-0e999tail", "+0e999tail", "Infinitytail",
  "+Infinitytail", "-Infinitytail", "infinity",
  "Inf", "NaN", "\u2212Infinity",
  "9007199254740993tail",
];
const expected: number[] = [
  Number.MAX_VALUE, Infinity, -Infinity, Number.MIN_VALUE, 0, -0,
  Number.MIN_VALUE, -Number.MIN_VALUE, Infinity, -Infinity, 0, -0,
  -0, 0, Infinity, Infinity, -Infinity, NaN,
  NaN, NaN, NaN, 9007199254740992,
];
const log: unknown[] = [], wanted: unknown[] = [];
class FloatText {
  text: string;
  constructor(text: string) { this.text = text; }
  read(index: number): number {
    same(this.text, inputs[index]); const value = parseFloat(this.text); same(value, expected[index]);
    log.push("class", this.text, value); return value;
  }
}
const retained: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const source = new FloatText(inputs[index]), value = source.read(index); same(value, expected[index]); retained.push(value);
  same(source.text, inputs[index]); wanted.push("class", inputs[index], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
