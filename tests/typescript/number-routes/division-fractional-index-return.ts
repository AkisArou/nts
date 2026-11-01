/*---
description: A quotient returned as number reads undefined at a fractional array index instead of truncating it.
features: [ts-number-route-division, ts-numbers, ts-functions, ts-arrays]
---*/
// Route: a declared numeric return used as an array index; node gives the fixed values, signs and text below.
function numberIndex(a: number, b: number): number { return a / b; }
const numberSamples = [
  { a: 0, b: 2, index: 0, indexText: "0", inverse: Infinity, inverseText: "Infinity", expected: 11, text: "11", kind: "number" },
  { a: -0, b: 2, index: -0, indexText: "0", inverse: -Infinity, inverseText: "-Infinity", expected: 11, text: "11", kind: "number" },
  { a: 1, b: 2, index: 0.5, indexText: "0.5", inverse: 2, inverseText: "2", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 2, b: 2, index: 1, indexText: "1", inverse: 1, inverseText: "1", expected: 22, text: "22", kind: "number" },
  { a: 3, b: 2, index: 1.5, indexText: "1.5", inverse: 0.6666666666666666, inverseText: "0.6666666666666666", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 4, b: 2, index: 2, indexText: "2", inverse: 0.5, inverseText: "0.5", expected: 33, text: "33", kind: "number" },
  { a: 5, b: 2, index: 2.5, indexText: "2.5", inverse: 0.4, inverseText: "0.4", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 6, b: 2, index: 3, indexText: "3", inverse: 0.3333333333333333, inverseText: "0.3333333333333333", expected: 44, text: "44", kind: "number" },
  { a: -1, b: 2, index: -0.5, indexText: "-0.5", inverse: -2, inverseText: "-2", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 2147483647, b: 2, index: 1073741823.5, indexText: "1073741823.5", inverse: 9.313225750491594e-10, inverseText: "9.313225750491594e-10", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 2147483648, b: 2, index: 1073741824, indexText: "1073741824", inverse: 9.313225746154785e-10, inverseText: "9.313225746154785e-10", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 4294967296, b: 2, index: 2147483648, indexText: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 9007199254740992, b: 2, index: 4503599627370496, indexText: "4503599627370496", inverse: 2.220446049250313e-16, inverseText: "2.220446049250313e-16", expected: undefined, text: "undefined", kind: "undefined" },
  { a: 9007199254740994, b: 2, index: 4503599627370497, indexText: "4503599627370497", inverse: 2.2204460492503126e-16, inverseText: "2.2204460492503126e-16", expected: undefined, text: "undefined", kind: "undefined" },
  { a: NaN, b: 2, index: NaN, indexText: "NaN", inverse: NaN, inverseText: "NaN", expected: undefined, text: "undefined", kind: "undefined" },
  { a: Infinity, b: 2, index: Infinity, indexText: "Infinity", inverse: 0, inverseText: "0", expected: undefined, text: "undefined", kind: "undefined" },
  { a: -Infinity, b: 2, index: -Infinity, indexText: "-Infinity", inverse: -0, inverseText: "0", expected: undefined, text: "undefined", kind: "undefined" },
];
for (const row of numberSamples) {
  const index: number = numberIndex(row.a, row.b); const actual: number | undefined = [11, 22, 33, 44][index];
  assert.sameValue(Object.is(index, row.index), true); assert.sameValue(typeof index, "number"); assert.sameValue(String(index), row.indexText);
  assert.sameValue(Object.is(1 / index, row.inverse), true); assert.sameValue(typeof (1 / index), "number"); assert.sameValue(String(1 / index), row.inverseText);
  assert.sameValue(Object.is(actual, row.expected), true); assert.sameValue(typeof actual, row.kind); assert.sameValue(String(actual), row.text);
}
