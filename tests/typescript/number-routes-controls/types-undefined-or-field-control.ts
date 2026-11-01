/*---
description: Control for types-undefined-or-field; the same computation uses plain local number variables.
features: [ts-number-route-types, ts-numbers, ts-unions, ts-class, ts-class-fields]
---*/
// Control: types-undefined-or-field; replace the numeric carrier with plain number locals.
const numberSamples = [
  { input: 0, present: true, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
  { input: -0, present: true, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
  { input: 1, present: true, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { input: 7, present: true, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
  { input: -7, present: true, expected: -7, text: "-7", inverse: -0.14285714285714285, inverseText: "-0.14285714285714285" },
  { input: 2147483647, present: true, expected: 2147483647, text: "2147483647", inverse: 4.656612875245797e-10, inverseText: "4.656612875245797e-10" },
  { input: 2147483648, present: true, expected: 2147483648, text: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10" },
  { input: 4294967296, present: true, expected: 4294967296, text: "4294967296", inverse: 2.3283064365386963e-10, inverseText: "2.3283064365386963e-10" },
  { input: 9007199254740992, present: true, expected: 9007199254740992, text: "9007199254740992", inverse: 1.1102230246251565e-16, inverseText: "1.1102230246251565e-16" },
  { input: 9007199254740994, present: true, expected: 9007199254740994, text: "9007199254740994", inverse: 1.1102230246251563e-16, inverseText: "1.1102230246251563e-16" },
  { input: 1.25, present: true, expected: 1.25, text: "1.25", inverse: 0.8, inverseText: "0.8" },
  { input: NaN, present: true, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
  { input: Infinity, present: true, expected: Infinity, text: "Infinity", inverse: 0, inverseText: "0" },
  { input: -Infinity, present: true, expected: -Infinity, text: "-Infinity", inverse: -0, inverseText: "0" },
  { input: 0, present: false, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
  { input: NaN, present: false, expected: 7, text: "7", inverse: 0.14285714285714285, inverseText: "0.14285714285714285" },
];
for (const row of numberSamples) {
  const local: number = row.input, fallback: number = 7;
  const actual: number = row.present && local ? local : fallback;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
