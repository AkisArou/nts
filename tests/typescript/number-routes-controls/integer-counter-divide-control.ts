/*---
description: Control for integer-counter-divide; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-iteration, ts-functions]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
function carryInteger(value: number): number { return value; }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 0, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 1, received: 1, receivedText: "1", expected: 0.5, text: "0.5" },
  { input: 2, received: 2, receivedText: "2", expected: 1, text: "1" },
  { input: 3, received: 3, receivedText: "3", expected: 1.5, text: "1.5" },
  { input: 4, received: 4, receivedText: "4", expected: 2, text: "2" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  let produced: number = 0;
  for (; produced < sample.input; produced++) {}
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed / 2;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
