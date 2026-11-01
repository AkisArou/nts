/*---
description: Control for special-nan-comparisons-return; the numeric carrier is a plain local.
features: [ts-number-route-zero-nan, ts-numbers, ts-functions]
---*/
// Control: the same computations, inputs and checks use plain numeric locals.
const rows: { input: number; expected: number; text: string; negative: boolean; equal: boolean; less: boolean; atMost: boolean; greater: boolean; atLeast: boolean }[] = [
  { input: 1, expected: 1, text: "1", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: -1, expected: -1, text: "-1", negative: false, equal: true, less: true, atMost: true, greater: false, atLeast: false },
  { input: 0, expected: 0, text: "0", negative: false, equal: true, less: false, atMost: true, greater: false, atLeast: true },
  { input: -0, expected: -0, text: "0", negative: true, equal: true, less: false, atMost: true, greater: false, atLeast: true },
  { input: 1.5, expected: 1.5, text: "1.5", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: 2 ** 31 - 1, expected: 2147483647, text: "2147483647", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: 2 ** 31, expected: 2147483648, text: "2147483648", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: 2 ** 32, expected: 4294967296, text: "4294967296", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: 2 ** 53, expected: 9007199254740992, text: "9007199254740992", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: 2 ** 53 + 2, expected: 9007199254740994, text: "9007199254740994", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: NaN, expected: NaN, text: "NaN", negative: false, equal: false, less: false, atMost: false, greater: false, atLeast: false },
  { input: Infinity, expected: Infinity, text: "Infinity", negative: false, equal: true, less: false, atMost: false, greater: true, atLeast: true },
  { input: -Infinity, expected: -Infinity, text: "-Infinity", negative: false, equal: true, less: true, atMost: true, greater: false, atLeast: false },
];
function specialTruth(actual: boolean, expected: boolean): void {
  assert.sameValue(Object.is(actual, expected), true);
  assert.sameValue(typeof actual, "boolean");
  assert.sameValue(String(actual), expected ? "true" : "false");
}
for (const row of rows) {
  const actual: number = row.input;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, row.negative ? -Infinity : Infinity), true);
  specialTruth(actual === actual, row.equal);
  specialTruth(actual !== actual, !row.equal);
  specialTruth(actual < 0, row.less);
  specialTruth(actual <= 0, row.atMost);
  specialTruth(actual > 0, row.greater);
  specialTruth(actual >= 0, row.atLeast);
}
