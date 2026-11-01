/*---
description: Array search indices, including a missing index cross a readonly numeric tuple slot; sums cross signed and unsigned 32-bit boundaries and round past the safe-integer boundary.
features: [ts-number-route-integers, ts-numbers, ts-arrays, ts-arrow-functions, ts-tuples, ts-readonly]
---*/
// Route: a readonly numeric tuple slot; node preserves the produced value and ordinary number result.
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; offset: number; }
const samples: IntegerSample[] = [
  { input: 44, received: -1, receivedText: "-1", expected: 2147483646, text: "2147483646", offset: 2147483647 },
  { input: 11, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647", offset: 2147483647 },
  { input: 22, received: 1, receivedText: "1", expected: 2147483648, text: "2147483648", offset: 2147483647 },
  { input: 33, received: 2, receivedText: "2", expected: 2147483649, text: "2147483649", offset: 2147483647 },
  { input: 22, received: 1, receivedText: "1", expected: 4294967296, text: "4294967296", offset: 4294967295 },
  { input: 11, received: 0, receivedText: "0", expected: 9007199254740991, text: "9007199254740991", offset: 9007199254740991 },
  { input: 22, received: 1, receivedText: "1", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: 33, received: 2, receivedText: "2", expected: 9007199254740992, text: "9007199254740992", offset: 9007199254740991 },
  { input: 33, received: 2, receivedText: "2", expected: 9007199254740994, text: "9007199254740994", offset: 9007199254740992 },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = [11, 22, 33].findIndex(value => value === sample.input);
  const cell: readonly [number] = [produced];
  const routed: number = cell[0];
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed + sample.offset;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
