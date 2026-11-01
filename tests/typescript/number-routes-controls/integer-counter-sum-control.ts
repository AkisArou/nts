/*---
description: Control for integer-counter-sum; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-iteration, ts-functions]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
function carryInteger(value: number): number { return value; }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; offset: number; }
const samples: IntegerSample[] = [
  { input: 0, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647", offset: 2147483647 },
  { input: 1, received: 1, receivedText: "1", expected: 2147483648, text: "2147483648", offset: 2147483647 },
  { input: 2, received: 2, receivedText: "2", expected: 2147483649, text: "2147483649", offset: 2147483647 },
  { input: 1, received: 1, receivedText: "1", expected: 4294967296, text: "4294967296", offset: 4294967295 },
  { input: 0, received: 0, receivedText: "0", expected: 9007199254740991, text: "9007199254740991", offset: 9007199254740991 },
  { input: 1, received: 1, receivedText: "1", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: 2, received: 2, receivedText: "2", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: 3, received: 3, receivedText: "3", expected: 9007199254740994, text: "9007199254740994", offset: 9007199254740991 },
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
  const result: number = routed + sample.offset;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
