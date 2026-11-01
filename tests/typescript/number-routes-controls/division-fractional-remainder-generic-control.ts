/*---
description: Control for division-fractional-remainder-generic; the same computation uses plain local number variables.
features: [ts-number-route-division, ts-numbers, ts-generics, ts-functions]
---*/
// Control: division-fractional-remainder-generic; replace the numeric carrier with plain number locals.
const numberSamples = [
  { a: 7, b: 2, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: 5.5, b: 2, expected: 1.5, text: "1.5", inverse: 0.6666666666666666, inverseText: "0.6666666666666666" },
  { a: -5.5, b: 2, expected: -1.5, text: "-1.5", inverse: -0.6666666666666666, inverseText: "-0.6666666666666666" },
  { a: 5.5, b: -2, expected: 1.5, text: "1.5", inverse: 0.6666666666666666, inverseText: "0.6666666666666666" },
  { a: -5.5, b: -2, expected: -1.5, text: "-1.5", inverse: -0.6666666666666666, inverseText: "-0.6666666666666666" },
  { a: 0.3, b: 0.1, expected: 0.09999999999999998, text: "0.09999999999999998", inverse: 10.000000000000002, inverseText: "10.000000000000002" },
  { a: -0.3, b: 0.1, expected: -0.09999999999999998, text: "-0.09999999999999998", inverse: -10.000000000000002, inverseText: "-10.000000000000002" },
  { a: -0.5, b: 0.25, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: -0, b: 0.5, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 2147483647, b: 0.75, expected: 0.25, text: "0.25", inverse: 4, inverseText: "4" },
  { a: 2147483648, b: 0.75, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2" },
  { a: 4294967296, b: 0.75, expected: 0.25, text: "0.25", inverse: 4, inverseText: "4" },
  { a: 9007199254740992, b: 0.75, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2" },
  { a: 9007199254740994, b: 0.75, expected: 0.25, text: "0.25", inverse: 4, inverseText: "4" },
  { a: NaN, b: 0.5, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: 0.5, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: -Infinity, b: 0.5, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
];
for (const row of numberSamples) {
  const numerator: number = row.a, denominator: number = row.b; const actual: number = numerator % denominator;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
