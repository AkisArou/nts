/*---
description: Unsigned 32-bit shift results cross a constrained generic before ordinary addition exceeds uint32.
features: [ts-number-route-integers, ts-numbers, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Route: a generic constrained to number; node preserves the produced value and ordinary number result.
function carryInteger<T extends number>(value: T): T { return value; }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: -1, received: 4294967295, receivedText: "4294967295", expected: 4294967296, text: "4294967296" },
  { input: 0, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: -0, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: 3.75, received: 3, receivedText: "3", expected: 4, text: "4" },
  { input: -3.75, received: 4294967293, receivedText: "4294967293", expected: 4294967294, text: "4294967294" },
  { input: 2147483647, received: 2147483647, receivedText: "2147483647", expected: 2147483648, text: "2147483648" },
  { input: 2147483648, received: 2147483648, receivedText: "2147483648", expected: 2147483649, text: "2147483649" },
  { input: 4294967295, received: 4294967295, receivedText: "4294967295", expected: 4294967296, text: "4294967296" },
  { input: 4294967296, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: 9007199254740992, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: 9007199254740994, received: 2, receivedText: "2", expected: 3, text: "3" },
  { input: NaN, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: Infinity, received: 0, receivedText: "0", expected: 1, text: "1" },
  { input: -Infinity, received: 0, receivedText: "0", expected: 1, text: "1" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = sample.input >>> 0;
  const routed: number = carryInteger(produced);
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed + 1;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
