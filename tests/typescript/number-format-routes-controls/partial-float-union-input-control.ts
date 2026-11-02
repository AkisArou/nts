/*---
description: "Table control for partial-float-union-input; A string-or-record parameter is narrowed before parseFloat and preserves record identity and exact returns."
features: [ts-number-format-routes, ts-number-format-route-partial-parsing, ts-numbers, ts-conversions, ts-functions, ts-arrays, ts-iteration, ts-typeof-operator, ts-unknown, ts-strings, ts-interfaces, ts-objects, ts-type-aliases, ts-unions, ts-narrowing]
---*/
// The union parameter and any record identity are checked before its string payload is selected; each branch, text and numeric return is logged. Node gives the same partial parse for both declared input members. The control keeps the route and substitutes position-indexed literal results.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface TextRecord { text: string; }
type TextInput = string | TextRecord;
const inputs: TextInput[] = [
  "3.5tail", { text: "3.5tail" }, "-0tail", { text: "-0tail" },
  "0x1", { text: "0x1" }, "Infinityx", { text: "Infinityx" },
  "", { text: "" }, "+", { text: "+" },
  "1e+", { text: "1e+" }, ".e1", { text: ".e1" },
  ".1.2", { text: ".1.2" }, "1e-1x", { text: "1e-1x" },
];
const texts: string[] = [
  "3.5tail", "3.5tail", "-0tail", "-0tail", "0x1",
  "0x1", "Infinityx", "Infinityx", "", "",
  "+", "+", "1e+", "1e+", ".e1",
  ".e1", ".1.2", ".1.2", "1e-1x", "1e-1x",
];
const expected: number[] = [
  3.5, 3.5, -0, -0, 0, 0, Infinity, Infinity,
  NaN, NaN, NaN, NaN, 1, 1, NaN, NaN,
  0.1, 0.1, 0.1, 0.1,
];
const log: unknown[] = [], wanted: unknown[] = [];
function consume(input: TextInput, index: number): number {
  same(input, inputs[index]); let text: string;
  if (typeof input === "string") { text = input; log.push("text"); }
  else { text = input.text; log.push("record"); }
  same(text, texts[index]); const value = expected[index]; same(value, expected[index]);
  log.push(text, value); return value;
}
const retained: number[] = [];
for (let index = 0; index < inputs.length; index++) {
  const value = consume(inputs[index], index); same(value, expected[index]); retained.push(value);
  wanted.push(index % 2 === 0 ? "text" : "record", texts[index], expected[index]);
}
same(retained.length, inputs.length);
for (let index = 0; index < retained.length; index++) same(retained[index], expected[index]);
assert.compareArray(log, wanted);
