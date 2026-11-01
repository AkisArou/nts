/*---
description: A declared number parameter and return keep unary negation of positive zero negative.
features: [ts-number-route-zero-nan, ts-numbers, ts-functions]
---*/
// Route: unary negation consumes a number parameter and leaves a number return; node preserves its sign.
function specialNegate(value: number): number { return -value; }
const rows: { input: number; expected: number; text: string; negative: boolean }[] = [
  { input: 1, expected: -1, text: "-1", negative: false },
  { input: -1, expected: 1, text: "1", negative: false },
  { input: 0, expected: -0, text: "0", negative: true },
  { input: -0, expected: 0, text: "0", negative: false },
  { input: 0.5, expected: -0.5, text: "-0.5", negative: false },
  { input: 2 ** 31 - 1, expected: -2147483647, text: "-2147483647", negative: false },
  { input: 2 ** 31, expected: -2147483648, text: "-2147483648", negative: false },
  { input: 2 ** 32, expected: -4294967296, text: "-4294967296", negative: false },
  { input: 2 ** 53, expected: -9007199254740992, text: "-9007199254740992", negative: false },
  { input: 2 ** 53 + 2, expected: -9007199254740994, text: "-9007199254740994", negative: false },
  { input: NaN, expected: NaN, text: "NaN", negative: false },
  { input: Infinity, expected: -Infinity, text: "-Infinity", negative: false },
  { input: -Infinity, expected: Infinity, text: "Infinity", negative: false },
];
for (const row of rows) {
  const actual: number = specialNegate(row.input);
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, row.negative ? -Infinity : Infinity), true);
}
