/*---
description: Control for integer-index-fraction; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-arrays, ts-arrow-functions, ts-tuples, ts-readonly]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 11, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 22, received: 1, receivedText: "1", expected: 0.25, text: "0.25" },
  { input: 33, received: 2, receivedText: "2", expected: 0.5, text: "0.5" },
  { input: 44, received: -1, receivedText: "-1", expected: -0.25, text: "-0.25" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = [11, 22, 33].findIndex(value => value === sample.input);
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed * 0.25;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
