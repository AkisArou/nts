/*---
description: Bitwise complement results cross a declared number call before ordinary subtraction leaves int32.
features: [ts-number-route-integers, ts-numbers, ts-functions]
---*/
// Route: a declared number parameter and return; node preserves the produced value and ordinary number result.
function carryInteger(value: number): number { return value; }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 0, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
  { input: -0, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
  { input: 1, received: -2, receivedText: "-2", expected: -2147483650, text: "-2147483650" },
  { input: -1, received: 0, receivedText: "0", expected: -2147483648, text: "-2147483648" },
  { input: 3.75, received: -4, receivedText: "-4", expected: -2147483652, text: "-2147483652" },
  { input: -3.75, received: 2, receivedText: "2", expected: -2147483646, text: "-2147483646" },
  { input: 2147483647, received: -2147483648, receivedText: "-2147483648", expected: -4294967296, text: "-4294967296" },
  { input: 2147483648, received: 2147483647, receivedText: "2147483647", expected: -1, text: "-1" },
  { input: 4294967295, received: 0, receivedText: "0", expected: -2147483648, text: "-2147483648" },
  { input: 4294967296, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
  { input: 9007199254740994, received: -3, receivedText: "-3", expected: -2147483651, text: "-2147483651" },
  { input: NaN, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
  { input: Infinity, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
  { input: -Infinity, received: -1, receivedText: "-1", expected: -2147483649, text: "-2147483649" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = ~sample.input;
  const routed: number = carryInteger(produced);
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed - 2147483648;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
