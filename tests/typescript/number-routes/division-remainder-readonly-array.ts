/*---
description: A readonly numeric array parameter preserves finite and exceptional remainder operands.
features: [ts-number-route-division, ts-numbers, ts-functions, ts-arrays, ts-readonly]
---*/
// Route: remainder operands cross a readonly numeric array view; node gives the fixed values, signs and text below.
function readonlyRemainder(values: readonly number[]): number { return values[0] % values[1]; }
const numberSamples = [
  { a: 7, b: 3, expected: 1, text: "1", inverse: 1, inverseText: "1" },
  { a: -7, b: 3, expected: -1, text: "-1", inverse: -1, inverseText: "-1" },
  { a: -0, b: 5, expected: -0, text: "0", inverse: -Infinity, inverseText: "-Infinity" },
  { a: 0, b: 5, expected: 0, text: "0", inverse: Infinity, inverseText: "Infinity" },
  { a: 7, b: 0, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: 7, b: -0, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: 1.25, b: Infinity, expected: 1.25, text: "1.25", inverse: 0.8, inverseText: "0.8" },
  { a: -1.25, b: Infinity, expected: -1.25, text: "-1.25", inverse: -0.8, inverseText: "-0.8" },
  { a: 2147483647, b: Infinity, expected: 2147483647, text: "2147483647", inverse: 4.656612875245797e-10, inverseText: "4.656612875245797e-10" },
  { a: 2147483648, b: -Infinity, expected: 2147483648, text: "2147483648", inverse: 4.656612873077393e-10, inverseText: "4.656612873077393e-10" },
  { a: 4294967296, b: Infinity, expected: 4294967296, text: "4294967296", inverse: 2.3283064365386963e-10, inverseText: "2.3283064365386963e-10" },
  { a: 9007199254740992, b: Infinity, expected: 9007199254740992, text: "9007199254740992", inverse: 1.1102230246251565e-16, inverseText: "1.1102230246251565e-16" },
  { a: 9007199254740994, b: Infinity, expected: 9007199254740994, text: "9007199254740994", inverse: 1.1102230246251563e-16, inverseText: "1.1102230246251563e-16" },
  { a: NaN, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: 3, b: NaN, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: Infinity, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
  { a: -Infinity, b: 3, expected: NaN, text: "NaN", inverse: NaN, inverseText: "NaN" },
];
for (const row of numberSamples) {
  const values: number[] = [1, 1]; values[0] = row.a; values[1] = row.b; const actual: number = readonlyRemainder(values);
  assert.sameValue(Object.is(actual, row.expected), true);
  assert.sameValue(typeof actual, "number"); assert.sameValue(String(actual), row.text);
  const inverse: number = 1 / actual;
  assert.sameValue(Object.is(inverse, row.inverse), true);
  assert.sameValue(typeof inverse, "number"); assert.sameValue(String(inverse), row.inverseText);
}
