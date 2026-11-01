/*---
description: Array search indices, including a missing index cross a readonly numeric tuple slot; division retains fractional results.
features: [ts-number-route-integers, ts-numbers, ts-arrays, ts-arrow-functions, ts-tuples, ts-readonly]
---*/
// Route: a readonly numeric tuple slot; node preserves the produced value and ordinary number result.
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 11, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 22, received: 1, receivedText: "1", expected: 0.5, text: "0.5" },
  { input: 33, received: 2, receivedText: "2", expected: 1, text: "1" },
  { input: 44, received: -1, receivedText: "-1", expected: -0.5, text: "-0.5" },
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
  const result: number = routed / 2;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
