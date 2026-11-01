/*---
description: Control for integer-index-of-sum; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-strings, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
function carryInteger<T extends number>(value: T): T { return value; }
interface IntegerSample { input: string; received: number; receivedText: string; expected: number; text: string; offset: number; }
const samples: IntegerSample[] = [
  { input: "x", received: -1, receivedText: "-1", expected: 2147483646, text: "2147483646", offset: 2147483647 },
  { input: "c", received: 0, receivedText: "0", expected: 2147483647, text: "2147483647", offset: 2147483647 },
  { input: "a", received: 1, receivedText: "1", expected: 2147483648, text: "2147483648", offset: 2147483647 },
  { input: "b", received: 2, receivedText: "2", expected: 2147483649, text: "2147483649", offset: 2147483647 },
  { input: "a", received: 1, receivedText: "1", expected: 4294967296, text: "4294967296", offset: 4294967295 },
  { input: "c", received: 0, receivedText: "0", expected: 9007199254740991, text: "9007199254740991", offset: 9007199254740991 },
  { input: "a", received: 1, receivedText: "1", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: "b", received: 2, receivedText: "2", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: "b", received: 2, receivedText: "2", expected: 9007199254740994, text: "9007199254740994", offset: 9007199254740992 },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = "cab".indexOf(sample.input);
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed + sample.offset;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
