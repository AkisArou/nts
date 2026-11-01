/*---
description: Control for division-wide-quotient-return; the same computation uses plain local number variables.
features: [ts-number-route-division, ts-numbers, ts-functions]
---*/
// Control: division-wide-quotient-return; replace the numeric carrier with plain number locals.
const numberSamples = [
  { a: 0, b: 3, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2", quotient: 0, quotientText: "0", quotientInverse: Infinity, quotientInverseText: "Infinity" },
  { a: -0, b: 3, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2", quotient: -0, quotientText: "0", quotientInverse: -Infinity, quotientInverseText: "-Infinity" },
  { a: 1, b: 3, expected: 0.8333333333333333, text: "0.8333333333333333", inverse: 1.2000000000000002, inverseText: "1.2000000000000002", quotient: 0.3333333333333333, quotientText: "0.3333333333333333", quotientInverse: 3, quotientInverseText: "3" },
  { a: 7, b: 3, expected: 2.8333333333333335, text: "2.8333333333333335", inverse: 0.3529411764705882, inverseText: "0.3529411764705882", quotient: 2.3333333333333335, quotientText: "2.3333333333333335", quotientInverse: 0.42857142857142855, quotientInverseText: "0.42857142857142855" },
  { a: -7, b: 3, expected: -1.8333333333333335, text: "-1.8333333333333335", inverse: -0.5454545454545454, inverseText: "-0.5454545454545454", quotient: -2.3333333333333335, quotientText: "-2.3333333333333335", quotientInverse: -0.42857142857142855, quotientInverseText: "-0.42857142857142855" },
  { a: 2147483647, b: 3, expected: 715827882.8333334, text: "715827882.8333334", inverse: 1.3969838615979571e-9, inverseText: "1.3969838615979571e-9", quotient: 715827882.3333334, quotientText: "715827882.3333334", quotientInverse: 1.396983862573739e-9, quotientInverseText: "1.396983862573739e-9" },
  { a: 2147483648, b: 3, expected: 715827883.1666666, text: "715827883.1666666", inverse: 1.3969838609474358e-9, inverseText: "1.3969838609474358e-9", quotient: 715827882.6666666, quotientText: "715827882.6666666", quotientInverse: 1.3969838619232178e-9, quotientInverseText: "1.3969838619232178e-9" },
  { a: 4294967296, b: 3, expected: 1431655765.8333333, text: "1431655765.8333333", inverse: 6.984919307176634e-10, inverseText: "6.984919307176634e-10", quotient: 1431655765.3333333, quotientText: "1431655765.3333333", quotientInverse: 6.984919309616089e-10, quotientInverseText: "6.984919309616089e-10" },
  { a: 9007199254740992, b: 3, expected: 3002399751580331, text: "3002399751580331", inverse: 3.330669073875469e-16, inverseText: "3.330669073875469e-16", quotient: 3002399751580330.5, quotientText: "3002399751580330.5", quotientInverse: 3.3306690738754696e-16, quotientInverseText: "3.3306690738754696e-16" },
  { a: 9007199254740994, b: 3, expected: 3002399751580332, text: "3002399751580332", inverse: 3.330669073875468e-16, inverseText: "3.330669073875468e-16", quotient: 3002399751580331.5, quotientText: "3002399751580331.5", quotientInverse: 3.3306690738754686e-16, quotientInverseText: "3.3306690738754686e-16" },
  { a: 1.25, b: 3, expected: 0.9166666666666667, text: "0.9166666666666667", inverse: 1.0909090909090908, inverseText: "1.0909090909090908", quotient: 0.4166666666666667, quotientText: "0.4166666666666667", quotientInverse: 2.4, quotientInverseText: "2.4" },
  { a: NaN, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN", quotient: NaN, quotientText: "NaN", quotientInverse: NaN, quotientInverseText: "NaN" },
  { a: Infinity, b: 3, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0", quotient: Infinity, quotientText: "Infinity", quotientInverse: 0, quotientInverseText: "0" },
  { a: -Infinity, b: 3, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0", quotient: -Infinity, quotientText: "-Infinity", quotientInverse: -0, quotientInverseText: "0" },
];
for (const row of numberSamples) {
  const numerator: number = row.a, denominator: number = 3; const quotient: number = numerator / denominator; const actual: number = quotient + 0.5;
  assert.sameValue(Object.is(quotient, row.quotient), true); assert.sameValue(typeof quotient, "number"); assert.sameValue(String(quotient), row.quotientText);
  assert.sameValue(Object.is(1 / quotient, row.quotientInverse), true); assert.sameValue(typeof (1 / quotient), "number"); assert.sameValue(String(1 / quotient), row.quotientInverseText);
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
