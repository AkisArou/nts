/*---
description: Control for integer-char-code-at-fraction; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-strings, ts-interfaces, ts-class, ts-class-fields]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
interface IntegerView { value: number; }
class FirstIntegerCell implements IntegerView { label: string = "first"; value: number; constructor(value: number) { this.value = value; } }
class SecondIntegerCell implements IntegerView { value: number; padding: number = 99; constructor(value: number) { this.value = value; } }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 0, received: 65, receivedText: "65", expected: 16.25, text: "16.25" },
  { input: 1, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 2, received: 65535, receivedText: "65535", expected: 16383.75, text: "16383.75" },
  { input: 3, received: 55357, receivedText: "55357", expected: 13839.25, text: "13839.25" },
  { input: 4, received: NaN, receivedText: "NaN", expected: NaN, text: "NaN" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const alternate of [false, true]) for (const sample of samples) {
  const produced: number = "A\u0000\uFFFF\uD83D".charCodeAt(sample.input);
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed * 0.25;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
