/*---
description: A numeric divisor field preserves zero signs when division produces infinities or NaN.
features: [ts-number-route-division, ts-numbers, ts-class, ts-class-fields]
---*/
// Route: a divisor field changes from a small integer to signed zero; node gives the fixed values, signs and text below.
class DivisionDivisor { value: number = 2; }
const numberSamples = [
  { a: 1, b: 2, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2" },
  { a: 1, b: 0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: 1, b: -0, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { a: -1, b: 0, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { a: -1, b: -0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: 0, b: 0, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: -0, b: 0, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: 2147483647, b: 0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: 2147483648, b: -0, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { a: 4294967296, b: 0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: 9007199254740992, b: -0, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { a: 9007199254740994, b: 2, expected: 4503599627370497, text: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16" },
  { a: 1.5, b: -0, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { a: NaN, b: 0, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: 0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: -Infinity, b: -0, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
];
for (const row of numberSamples) {
  const divisor = new DivisionDivisor(); divisor.value = row.b;
  const numerator: number = row.a; const actual: number = numerator / divisor.value;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
