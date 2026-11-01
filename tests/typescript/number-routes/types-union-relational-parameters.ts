/*---
description: Union parameters distinguish numeric ordering from lexicographic ordering when both operands are strings.
features: [ts-number-route-types, ts-numbers, ts-unions, ts-functions]
---*/
// Route: number-or-string parameters meet the relational operator; node gives the fixed values, signs and text below.
function compareNumberOrText(a: number | string, b: number | string): boolean { return a < b; }
const numberSamples = [
  { a: 2, b: 10, numeric: true, numericText: "true", textual: false, textualText: "false" },
  { a: 10, b: 2, numeric: false, numericText: "false", textual: true, textualText: "true" },
  { a: 3.25, b: 3.75, numeric: true, numericText: "true", textual: true, textualText: "true" },
  { a: 0, b: -0, numeric: false, numericText: "false", textual: false, textualText: "false" },
  { a: 2147483647, b: 2147483648, numeric: true, numericText: "true", textual: true, textualText: "true" },
  { a: 2147483648, b: 4294967296, numeric: true, numericText: "true", textual: true, textualText: "true" },
  { a: 4294967296, b: 9007199254740992, numeric: true, numericText: "true", textual: true, textualText: "true" },
  { a: 9007199254740992, b: 9007199254740994, numeric: true, numericText: "true", textual: true, textualText: "true" },
  { a: 9007199254740994, b: 9007199254740992, numeric: false, numericText: "false", textual: false, textualText: "false" },
  { a: 1e+21, b: 9007199254740994, numeric: false, numericText: "false", textual: true, textualText: "true" },
  { a: NaN, b: 2, numeric: false, numericText: "false", textual: false, textualText: "false" },
  { a: Infinity, b: 2, numeric: false, numericText: "false", textual: false, textualText: "false" },
  { a: -Infinity, b: -2, numeric: true, numericText: "true", textual: false, textualText: "false" },
];
for (const row of numberSamples) for (const textual of [false, true]) {
  const actual: boolean = compareNumberOrText(textual ? String(row.a) : row.a, textual ? String(row.b) : row.b);
  assert.sameValue(Object.is(actual, textual ? row.textual : row.numeric), true);
  assert.sameValue(typeof actual, "boolean"); assert.sameValue(String(actual), textual ? row.textualText : row.numericText);
}
