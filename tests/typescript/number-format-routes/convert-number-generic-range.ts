/*---
description: Number rounds boundary numeric text read through two generic record layouts at integer, subnormal and overflow edges.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-generics, ts-generic-constraints]
---*/
// Numeric text crosses two generic record layouts; node logs exact binary64 rounding at integer, underflow and overflow boundaries.
const rows: [string, number][] = [
  ["9007199254740991", 9007199254740991.0], ["9007199254740992", 9007199254740992.0], ["9007199254740993", 9007199254740992.0], ["9007199254740994", 9007199254740994.0],
  ["-9007199254740993", -9007199254740992.0], ["999999999999999900000", 9.999999999999999e+20], ["1e21", 1e+21], ["1.0000000000000001e21", 1.0000000000000001e+21],
  ["9.999999999999998e-8", 9.999999999999998e-08], ["1e-7", 1e-07], ["1.0000000000000001e-7", 1.0000000000000001e-07], ["5e-324", Number.MIN_VALUE], ["-5e-324", -Number.MIN_VALUE],
  ["2.4703282292062327e-324", 0.0], ["2.4703282292062328e-324", Number.MIN_VALUE], ["-2.4703282292062327e-324", -0], ["-2.4703282292062328e-324", -Number.MIN_VALUE],
  ["1.7976931348623157e308", Number.MAX_VALUE], ["1.7976931348623158e308", Number.MAX_VALUE], ["1.7976931348623159e308", Infinity], ["-1.7976931348623159e308", -Infinity], ["1e-9999", 0.0],
  ["-1e-9999", -0], ["1e9999", Infinity], ["-1e9999", -Infinity], ["0.1", 0.1], ["-0", -0], ["invalid", NaN],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function convert<T extends { text: string }>(index: number, input: T): number {
  const value: string = input.text;
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = Number(value);
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  for (const result of [convert(index, { text: row[0], left: 7 }), convert(index, { right: "padding", text: row[0] })]) {
    assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
    expectedLog.push(row[0], row[1]);
  }
}
assert.compareArray(seen, expectedLog);
