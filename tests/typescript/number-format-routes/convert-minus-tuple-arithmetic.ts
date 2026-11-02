/*---
description: Unary minus performs arithmetic string conversion through a readonly tuple while preserving the resulting zero sign.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-readonly]
---*/
// Strings occupy readonly tuple slots before unary minus; node negates converted values, including positive and negative zero.
const rows: [string, number][] = [
  ["", -0], [" \t\n", -0], ["0", -0], ["-0", 0.0], ["+0", -0], ["0.0", -0], ["-0.0", 0.0], [".5", -0.5], ["-.5", 0.5], ["+.5", -0.5], ["1.5", -1.5], ["-2.5", 2.5], ["0x10", -16.0],
  ["0o10", -8.0], ["0b11", -3.0], ["+0x10", NaN], ["1e21", -1e+21], ["1e-7", -1e-07], ["5e-324", -Number.MIN_VALUE], ["-5e-324", Number.MIN_VALUE], ["1e309", -Infinity],
  ["-Infinity", Infinity], ["Infinity", -Infinity], ["1_000", NaN], ["12x", NaN], ["\u3000-0\ufeff", 0.0],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function convert(index: number, input: readonly [string, number]): number {
  const value: string = input[0]; assert.sameValue(Object.is(input[1], 7), true);
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = -value;
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const input: readonly [string, number] = [row[0], 7];
  const result = convert(index, input); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
