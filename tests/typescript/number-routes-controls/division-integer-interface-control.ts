/*---
description: Control for division-integer-interface; the same computation uses plain local number variables.
features: [ts-number-route-division, ts-numbers, ts-interfaces, ts-class, ts-class-fields]
---*/
// Control: division-integer-interface; replace the numeric carrier with plain number locals.
const numberSamples = [
  { a: 0, b: 2, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: -0, b: 2, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 1, b: 2, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2" },
  { a: 7, b: 2, expected: 3.5, text: "3.5", inverse: 0.2857142857142857, inverseText: "0.2857142857142857" },
  { a: -7, b: 2, expected: -3.5, text: "-3.5", inverse: -0.2857142857142857, inverseText: "-0.2857142857142857" },
  { a: 2147483647, b: 2, expected: 1073741823.5, text: "1073741823.5", inverse: 9.313225750491594e-10, inverseText: "9.313225750491594e-10" },
  { a: 2147483648, b: 2, expected: 1073741824, text: "1073741824", inverse: 9.313225746154785e-10, inverseText: "9.313225746154785e-10" },
  { a: 4294967296, b: 2, expected: 2147483648, text: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10" },
  { a: 9007199254740992, b: 2, expected: 4503599627370496, text: "4503599627370496", inverse: 2.220446049250313e-16, inverseText: "2.220446049250313e-16" },
  { a: 9007199254740994, b: 2, expected: 4503599627370497, text: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16" },
  { a: 1.25, b: 2, expected: 0.625, text: "0.625", inverse: 1.6, inverseText: "1.6" },
  { a: NaN, b: 2, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: 2, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { a: -Infinity, b: 2, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
];
for (const row of numberSamples) for (const layout of [false, true]) {
  const numerator: number = row.a, denominator: number = row.b;
  const actual: number = numerator / denominator;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
