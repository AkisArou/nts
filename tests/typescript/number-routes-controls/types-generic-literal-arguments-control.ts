/*---
description: Control for types-generic-literal-arguments; the same computation uses plain local number variables.
features: [ts-number-route-types, ts-numbers, ts-literal-types, ts-functions, ts-generics]
---*/
// Control: types-generic-literal-arguments; replace the numeric carrier with plain number locals.
const numberSamples: { a: number; b: number; expected: number; text: string; inverse: number; inverseText: string }[] = [
  { a: 0, b: 2, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: -0, b: 2, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 1, b: 2, expected: 0.5, text: "0.5", inverse: 2, inverseText: "2" },
  { a: 3, b: 2, expected: 1.5, text: "1.5", inverse: 0.6666666666666666, inverseText: "0.6666666666666666" },
  { a: -3, b: 2, expected: -1.5, text: "-1.5", inverse: -0.6666666666666666, inverseText: "-0.6666666666666666" },
  { a: 2147483647, b: 2, expected: 1073741823.5, text: "1073741823.5", inverse: 9.313225750491594e-10, inverseText: "9.313225750491594e-10" },
  { a: 2147483648, b: 2, expected: 1073741824, text: "1073741824", inverse: 9.313225746154785e-10, inverseText: "9.313225746154785e-10" },
  { a: 4294967296, b: 2, expected: 2147483648, text: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10" },
  { a: 9007199254740992, b: 2, expected: 4503599627370496, text: "4503599627370496", inverse: 2.220446049250313e-16, inverseText: "2.220446049250313e-16" },
  { a: 9007199254740994, b: 2, expected: 4503599627370497, text: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16" },
  { a: 1.25, b: 2, expected: 0.625, text: "0.625", inverse: 1.6, inverseText: "1.6" },
  { a: -0.5, b: 2, expected: -0.25, text: "-0.25", inverse: -4, inverseText: "-4" },
];
for (const row of numberSamples) {
  const local: number = row.a, scale: number = 0.5; const actual: number = local * scale;
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
