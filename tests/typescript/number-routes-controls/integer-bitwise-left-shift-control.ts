/*---
description: Control for integer-bitwise-left-shift; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-functions, ts-function-types, ts-closures, ts-arrow-functions]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
function captureInteger(value: number): () => number { return (): number => value; }
interface IntegerSample { input: number; received: number; receivedText: string; expected: number; text: string; }
const samples: IntegerSample[] = [
  { input: 0, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: -0, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: 1, received: 2, receivedText: "2", expected: 2147483649, text: "2147483649" },
  { input: -1, received: -2, receivedText: "-2", expected: 2147483645, text: "2147483645" },
  { input: 1073741823, received: 2147483646, receivedText: "2147483646", expected: 4294967293, text: "4294967293" },
  { input: 1073741824, received: -2147483648, receivedText: "-2147483648", expected: -1, text: "-1" },
  { input: 2147483647, received: -2, receivedText: "-2", expected: 2147483645, text: "2147483645" },
  { input: 2147483648, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: 4294967296, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: 9007199254740994, received: 4, receivedText: "4", expected: 2147483651, text: "2147483651" },
  { input: 1.75, received: 2, receivedText: "2", expected: 2147483649, text: "2147483649" },
  { input: NaN, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: Infinity, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
  { input: -Infinity, received: 0, receivedText: "0", expected: 2147483647, text: "2147483647" },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = sample.input << 1;
  const routed: number = produced;
  expectNumber(routed, sample.received, sample.receivedText, Infinity);
  const result: number = routed + 2147483647;
  expectNumber(result, sample.expected, sample.text, Infinity);
}
