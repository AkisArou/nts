/*---
description: Math.ceil results cross a generic constrained to number, preserving wide whole values and the sign of zero.
features: [ts-number-route-integers, ts-numbers, ts-functions, ts-generics, ts-generic-constraints]
---*/
// Route: a generic constrained to number; node preserves the produced value and ordinary number result.
function carryInteger<T extends number>(value: T): T { return value; }
interface IntegerSample { input: number; expected: number; text: string; reciprocal: number; }
const samples: IntegerSample[] = [
  { input: -2.75, expected: -2, text: "-2", reciprocal: Infinity },
  { input: -1.5, expected: -1, text: "-1", reciprocal: Infinity },
  { input: -0.5, expected: -0, text: "0", reciprocal: -Infinity },
  { input: -0, expected: -0, text: "0", reciprocal: -Infinity },
  { input: 0, expected: 0, text: "0", reciprocal: Infinity },
  { input: 0.25, expected: 1, text: "1", reciprocal: Infinity },
  { input: 0.5, expected: 1, text: "1", reciprocal: Infinity },
  { input: 1.5, expected: 2, text: "2", reciprocal: Infinity },
  { input: 2.75, expected: 3, text: "3", reciprocal: Infinity },
  { input: 2147483647.75, expected: 2147483648, text: "2147483648", reciprocal: Infinity },
  { input: 2147483648.25, expected: 2147483649, text: "2147483649", reciprocal: Infinity },
  { input: 4294967295.75, expected: 4294967296, text: "4294967296", reciprocal: Infinity },
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
  const produced: number = Math.ceil(sample.input);
  const routed: number = carryInteger(produced);
  expectNumber(routed, sample.expected, sample.text, sample.reciprocal);
}
