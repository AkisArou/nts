/*---
description: Control for special-zero-remainder-capture; the numeric carrier is a plain local.
features: [ts-number-route-zero-nan, ts-numbers, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// Control: the same computations, inputs and checks use plain numeric locals.
const rows: { input: number; expected: number; text: string; negative: boolean }[] = [
  { input: 1, expected: 1, text: "1", negative: false },
  { input: -1, expected: -1, text: "-1", negative: false },
  { input: 0, expected: 0, text: "0", negative: false },
  { input: -0, expected: -0, text: "0", negative: true },
  { input: 5, expected: 0, text: "0", negative: false },
  { input: -5, expected: -0, text: "0", negative: true },
  { input: -0.5, expected: -0.5, text: "-0.5", negative: false },
  { input: 2 ** 31 - 1, expected: 2, text: "2", negative: false },
  { input: 2 ** 31, expected: 3, text: "3", negative: false },
  { input: 2 ** 32, expected: 1, text: "1", negative: false },
  { input: 2 ** 53, expected: 2, text: "2", negative: false },
  { input: 2 ** 53 + 2, expected: 4, text: "4", negative: false },
  { input: NaN, expected: NaN, text: "NaN", negative: false },
  { input: Infinity, expected: NaN, text: "NaN", negative: false },
  { input: -Infinity, expected: NaN, text: "NaN", negative: false },
];
for (const row of rows) {
  let carried: number = 1;
  carried = row.input % 5;
  const actual: number = carried;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, row.negative ? -Infinity : Infinity), true);
}
