/*---
description: Control for special-zero-multiply-field; the numeric carrier is a plain local.
features: [ts-number-route-zero-nan, ts-numbers, ts-class, ts-class-fields]
---*/
// Control: the same computations, inputs and checks use plain numeric locals.
const rows: { input: number; expected: number; text: string; negative: boolean }[] = [
  { input: 1, expected: 0, text: "0", negative: false },
  { input: -1, expected: -0, text: "0", negative: true },
  { input: 0, expected: 0, text: "0", negative: false },
  { input: -0, expected: -0, text: "0", negative: true },
  { input: -0.5, expected: -0, text: "0", negative: true },
  { input: 3, expected: 0, text: "0", negative: false },
  { input: 2 ** 31 - 1, expected: 0, text: "0", negative: false },
  { input: 2 ** 31, expected: 0, text: "0", negative: false },
  { input: 2 ** 32, expected: 0, text: "0", negative: false },
  { input: 2 ** 53, expected: 0, text: "0", negative: false },
  { input: 2 ** 53 + 2, expected: 0, text: "0", negative: false },
  { input: NaN, expected: NaN, text: "NaN", negative: false },
  { input: Infinity, expected: NaN, text: "NaN", negative: false },
  { input: -Infinity, expected: NaN, text: "NaN", negative: false },
];
for (const row of rows) {
  let value: number = 1;
  value = 0 * row.input;
  const actual: number = value;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, row.negative ? -Infinity : Infinity), true);
  const normalized: number = actual | 0;
  assert.sameValue(Object.is(normalized, 0), true);
  assert.sameValue(typeof normalized, "number");
  assert.sameValue(String(normalized), "0");
  assert.sameValue(Object.is(1 / normalized, Infinity), true);
}
