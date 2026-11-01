/*---
description: Control for division-remainder-tuple; the same computation uses plain local number variables.
features: [ts-number-route-division, ts-numbers, ts-tuples]
---*/
// Control: division-remainder-tuple; replace the numeric carrier with plain number locals.
const numberSamples = [
  { a: 7, b: 3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: -7, b: 3, expected: -1, text: "-1", inverse: -1, inverseText: "-1" },
  { a: 7, b: -3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: -7, b: -3, expected: -1, text: "-1", inverse: -1, inverseText: "-1" },
  { a: -6, b: 3, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 6, b: -3, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: -0, b: 5, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 0, b: -5, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: 2147483647, b: 3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: 2147483648, b: 3, expected: 2, text: "2", inverse: 0.5, inverseText: "0.5" },
  { a: 4294967296, b: 3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: 9007199254740992, b: 3, expected: 2, text: "2", inverse: 0.5, inverseText: "0.5" },
  { a: 9007199254740994, b: 3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: -5.5, b: 2, expected: -1.5, text: "-1.5", inverse: -0.6666666666666666, inverseText: "-0.6666666666666666" },
  { a: NaN, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: -Infinity, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
];
for (const row of numberSamples) {
  let numerator: number = 1, denominator: number = 1; numerator = row.a; denominator = row.b;
  const actual: number = numerator % denominator;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
