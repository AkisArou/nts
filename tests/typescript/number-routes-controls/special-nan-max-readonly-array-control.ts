/*---
description: Control for special-nan-max-readonly-array; the numeric carrier is a plain local.
features: [ts-number-route-zero-nan, ts-numbers, ts-arrays, ts-readonly, ts-functions]
---*/
// Control: the same computations, inputs and checks use plain numeric locals.
const rows: { input: number; raw: number; rawText: string; negative: boolean; expected: number; text: string }[] = [
  { input: 1, raw: 1, rawText: "1", negative: false, expected: 1, text: "1" },
  { input: -1, raw: -1, rawText: "-1", negative: false, expected: 0, text: "0" },
  { input: 0, raw: 0, rawText: "0", negative: false, expected: 0, text: "0" },
  { input: -0, raw: -0, rawText: "0", negative: true, expected: 0, text: "0" },
  { input: -0.5, raw: -0.5, rawText: "-0.5", negative: false, expected: 0, text: "0" },
  { input: 1.5, raw: 1.5, rawText: "1.5", negative: false, expected: 1.5, text: "1.5" },
  { input: 2 ** 31 - 1, raw: 2147483647, rawText: "2147483647", negative: false, expected: 2147483647, text: "2147483647" },
  { input: 2 ** 31, raw: 2147483648, rawText: "2147483648", negative: false, expected: 2147483648, text: "2147483648" },
  { input: 2 ** 32, raw: 4294967296, rawText: "4294967296", negative: false, expected: 4294967296, text: "4294967296" },
  { input: 2 ** 53, raw: 9007199254740992, rawText: "9007199254740992", negative: false, expected: 9007199254740992, text: "9007199254740992" },
  { input: 2 ** 53 + 2, raw: 9007199254740994, rawText: "9007199254740994", negative: false, expected: 9007199254740994, text: "9007199254740994" },
  { input: NaN, raw: NaN, rawText: "NaN", negative: false, expected: NaN, text: "NaN" },
  { input: Infinity, raw: Infinity, rawText: "Infinity", negative: false, expected: Infinity, text: "Infinity" },
  { input: -Infinity, raw: -Infinity, rawText: "-Infinity", negative: false, expected: 0, text: "0" },
];
for (const row of rows) {
  let value: number = 1;
  value = row.input;
  const raw: number = value;
  assert.sameValue(Object.is(raw, row.raw), true);
  assert.sameValue(typeof raw, "number");
  assert.sameValue(String(raw), row.rawText);
  if (raw === 0) assert.sameValue(Object.is(1 / raw, row.negative ? -Infinity : Infinity), true);
  const actual: number = Math.max(0, raw);
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number");
  assert.sameValue(String(actual), row.text);
  if (actual === 0) assert.sameValue(Object.is(1 / actual, Infinity), true);
}
