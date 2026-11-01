/*---
description: A numeric field read through a constrained generic retains Math.min signed zero.
features: [ts-number-route-zero-nan, ts-numbers, ts-generics, ts-generic-constraints, ts-functions]
---*/
// Route: Math.min reads a number through a generic shape; node selects -0 from Math.min(0, -0).
function specialMinimum<T extends { amount: number }>(box: T): number { return Math.min(0, box.amount); }
const rows: { input: number; expected: number; text: string; negative: boolean }[] = [
  { input: 1, expected: 0, text: "0", negative: false },
  { input: -1, expected: -1, text: "-1", negative: false },
  { input: 0, expected: 0, text: "0", negative: false },
  { input: -0, expected: -0, text: "0", negative: true },
  { input: -0.5, expected: -0.5, text: "-0.5", negative: false },
  { input: 0.5, expected: 0, text: "0", negative: false },
  { input: 2 ** 31 - 1, expected: 0, text: "0", negative: false },
  { input: 2 ** 31, expected: 0, text: "0", negative: false },
  { input: 2 ** 32, expected: 0, text: "0", negative: false },
  { input: 2 ** 53, expected: 0, text: "0", negative: false },
  { input: 2 ** 53 + 2, expected: 0, text: "0", negative: false },
  { input: NaN, expected: NaN, text: "NaN", negative: false },
  { input: Infinity, expected: 0, text: "0", negative: false },
  { input: -Infinity, expected: -Infinity, text: "-Infinity", negative: false },
];
for (const row of rows) {
  const actual: number = specialMinimum({ amount: row.input, label: "input" });
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, row.negative ? -Infinity : Infinity), true);
}
