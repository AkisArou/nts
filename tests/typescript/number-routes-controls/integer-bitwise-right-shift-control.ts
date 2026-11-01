/*---
description: Control for integer-bitwise-right-shift; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-tuples, ts-readonly]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: -3.75, received: -2, receivedText: "-2", expected: -0.5, text: "-0.5" },
  { input: -1, received: -1, receivedText: "-1", expected: -0.25, text: "-0.25" },
  { input: -0, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 0, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 3.75, received: 1, receivedText: "1", expected: 0.25, text: "0.25" },
  { input: 2147483647, received: 1073741823, receivedText: "1073741823", expected: 268435455.75, text: "268435455.75" },
  { input: 2147483648, received: -1073741824, receivedText: "-1073741824", expected: -268435456, text: "-268435456" },
  { input: 4294967295, received: -1, receivedText: "-1", expected: -0.25, text: "-0.25" },
  { input: 4294967296, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 9007199254740992, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: NaN, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: Infinity, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: -Infinity, received: 0, receivedText: "0", expected: 0, text: "0" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = sample.input >> 1;
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed * 0.25;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
