/*---
description: Array and string lengths cross a declared class number field; division retains fractional results.
features: [ts-number-route-integers, ts-numbers, ts-arrays, ts-strings, ts-class, ts-class-fields]
---*/
// Route: a declared class number field; node preserves the produced value and ordinary number result.
class IntegerCell { value: number; constructor(value: number) { this.value = value; } }
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
for (const fromString of [false, true]) for (const sample of samples) {
  const items: number[] = [7, 8, 9, 10]; items.length = sample.input;
  const text: string = "abcd".slice(0, sample.input);
  const produced: number = fromString ? text.length : items.length;
  const routed: number = new IntegerCell(produced).value;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed / 2;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
