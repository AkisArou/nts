/*---
description: Control for division-infinite-divisor-closure; the same computation uses plain local number variables.
features: [ts-number-route-division, ts-numbers, ts-closures, ts-function-types]
---*/
// Control: division-infinite-divisor-closure; replace the numeric carrier with plain number locals.
const numberSamples = [
  { a: 7, b: 2, expected: 3.5, text: "3.5", inverse: 0.2857142857142857, inverseText: "0.2857142857142857" },
  { a: 1, b: Infinity, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: -1, b: Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 1, b: -Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: -1, b: -Infinity, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: 0, b: Infinity, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: -0, b: Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 2147483647, b: Infinity, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: 2147483648, b: -Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 4294967296, b: Infinity, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: 9007199254740992, b: -Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 9007199254740994, b: 2, expected: 4503599627370497, text: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16" },
  { a: 1.25, b: -Infinity, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: NaN, b: Infinity, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: Infinity, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: -Infinity, b: -Infinity, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
];
for (const row of numberSamples) {
  let divisor: number = 2; divisor = row.b;
  const numerator: number = row.a; const actual: number = numerator / divisor;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
