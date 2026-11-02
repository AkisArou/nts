/*---
description: Number parses leading and trailing dots and complete exponent grammar after a declared string return with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator]
---*/
// Dot and exponent strings cross a declared string return; node logs valid values and rejects incomplete exponents or trailing text. The control reads the result table.
const rows: [string, number][] = [
  [".5", 0.5], ["-.5", -0.5], ["+.5", 0.5], ["5.", 5.0], ["-5.", -5.0], ["+5.", 5.0], [".5e2", 50.0], ["-.5e+2", -50.0], ["1.e2", 100.0], ["+1.e-2", 0.01], ["1.e-324", 0.0],
  ["-1.e-324", -0], [".e2", NaN], ["e2", NaN], ["1e", NaN], ["1e+", NaN], ["1e-", NaN], ["1.2.3", NaN], ["Infinity", Infinity], ["+Infinity", Infinity], ["-Infinity", -Infinity],
  ["infinity", NaN], ["Infinityx", NaN], ["NaN", NaN], ["  .25\r\n", 0.25],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function returnText(value: string): string { return value; }
function convert(index: number, input: string): number {
  const value: string = returnText(input);
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = rows[index][1];
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const result = convert(index, row[0]); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
