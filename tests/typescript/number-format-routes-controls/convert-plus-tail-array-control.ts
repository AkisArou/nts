/*---
description: Unary plus requires the entire readonly string-array element to match the numeric grammar with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-readonly]
---*/
// String-array elements include separators, suffixes and embedded spaces; node logs NaN for a bad whole string beside valid witnesses. The control reads the result table.
const rows: [string, number][] = [
  ["12", 12.0], ["12x", NaN], ["12 x", NaN], ["12\u0000", NaN], ["1_000", NaN], ["0x1_0", NaN], ["0o1_0", NaN], ["0b1_0", NaN], ["1n", NaN], ["0b1n", NaN], ["1,000", NaN], ["1 2", NaN],
  ["1\n2", NaN], ["1\u00a02", NaN], ["0x10tail", NaN], ["2e3x", NaN], ["2e3", 2000.0], ["2.e3", 2000.0], ["0x1p2", NaN], ["0b1.0", NaN], ["NaN", NaN], ["nan", NaN], ["INF", NaN],
  ["+", NaN], ["-", NaN], [".", NaN], ["\u200b", NaN], ["12\u200b", NaN], ["\ud800", NaN], ["\uff11\uff12", NaN], ["\u0661", NaN], ["-0", -0],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function convert(index: number, input: readonly string[]): number {
  const value: string = input[1];
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = rows[index][1];
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const input: readonly string[] = ["sentinel", row[0], "tail"];
  const result = convert(index, input); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
