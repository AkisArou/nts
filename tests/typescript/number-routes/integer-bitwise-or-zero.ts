/*---
description: ToInt32 results cross a number field before ordinary division retains halves.
features: [ts-number-route-integers, ts-numbers, ts-class, ts-class-fields]
---*/
// Route: a declared class number field; node preserves the produced value and ordinary number result.
class IntegerCell { value: number; constructor(value: number) { this.value = value; } }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 0, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: -0, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 3.75, received: 3, receivedText: "3", expected: 1.5, text: "1.5" },
  { input: -3.75, received: -3, receivedText: "-3", expected: -1.5, text: "-1.5" },
  { input: 2147483647, received: 2147483647, receivedText: "2147483647", expected: 1073741823.5, text: "1073741823.5" },
  { input: 2147483648, received: -2147483648, receivedText: "-2147483648", expected: -1073741824, text: "-1073741824" },
  { input: 4294967296, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 4294967297, received: 1, receivedText: "1", expected: 0.5, text: "0.5" },
  { input: 9007199254740992, received: 0, receivedText: "0", expected: 0, text: "0" },
  { input: 9007199254740994, received: 2, receivedText: "2", expected: 1, text: "1" },
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
  const produced: number = sample.input | 0;
  const routed: number = new IntegerCell(produced).value;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed / 2;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
