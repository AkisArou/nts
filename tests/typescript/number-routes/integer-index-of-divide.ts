/*---
description: String indexOf results, including a missing match cross a generic constrained to number; division retains fractional results.
features: [ts-number-route-integers, ts-numbers, ts-strings, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Route: a generic constrained to number; node preserves the produced value and ordinary number result.
function carryInteger<T extends number>(value: T): T { return value; }
interface IntegerSample { input: string; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: "c", received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: "a", received: 1, receivedText: "1", expected: 0.5, text: "0.5" },
  { input: "b", received: 2, receivedText: "2", expected: 1, text: "1" },
  { input: "x", received: -1, receivedText: "-1", expected: -0.5, text: "-0.5" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = "cab".indexOf(sample.input);
  const routed: number = carryInteger(produced);
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed / 2;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
