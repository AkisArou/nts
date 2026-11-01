/*---
description: Control for integer-math-round; a plain local number retains the same computation and fixed observations.
features: [ts-number-route-integers, ts-numbers, ts-tuples, ts-readonly]
---*/
// Control: the produced number is held in a plain local; node gives the same fixed values, signs and text.
interface IntegerSample { input: number; expected: number; text: string; reciprocal: number; }
const samples: IntegerSample[] = [
  { input: -2.75, expected: -3, text: "-3", reciprocal: Infinity },
  { input: -2.5, expected: -2, text: "-2", reciprocal: Infinity },
  { input: -1.5, expected: -1, text: "-1", reciprocal: Infinity },
  { input: -0.5, expected: -0, text: "0", reciprocal: -Infinity },
  { input: -0.4, expected: -0, text: "0", reciprocal: -Infinity },
  { input: -0, expected: -0, text: "0", reciprocal: -Infinity },
  { input: 0, expected: 0, text: "0", reciprocal: Infinity },
  { input: 0.4, expected: 0, text: "0", reciprocal: Infinity },
  { input: 0.5, expected: 1, text: "1", reciprocal: Infinity },
  { input: 1.5, expected: 2, text: "2", reciprocal: Infinity },
  { input: 2.5, expected: 3, text: "3", reciprocal: Infinity },
  { input: 2147483647.5, expected: 2147483648, text: "2147483648", reciprocal: Infinity },
  { input: 2147483648.5, expected: 2147483649, text: "2147483649", reciprocal: Infinity },
  { input: 4294967295.5, expected: 4294967296, text: "4294967296", reciprocal: Infinity },
  { input: 9007199254740992, expected: 9007199254740992, text: "9007199254740992", reciprocal: Infinity },
  { input: 9007199254740994, expected: 9007199254740994, text: "9007199254740994", reciprocal: Infinity },
];
function expectNumber(actual: number, expected: number, text: string, reciprocal: number): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), text);
  if (expected === 0) assert.sameValue(Object.is(1 / actual, reciprocal), true);
}
for (const sample of samples) {
  const produced: number = Math.round(sample.input);
  const routed: number = produced;
  expectNumber(routed, sample.expected, sample.text, sample.reciprocal);
}
