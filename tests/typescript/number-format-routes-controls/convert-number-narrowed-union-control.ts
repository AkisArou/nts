/*---
description: Number preserves each narrowed number, string and null arm through a shared parameter with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-unions, ts-null-undefined]
---*/
// A number/string/null parameter is narrowed before Number; node logs the selected arm and exact payload, including negative zero and NaN. The control reads the result table.
const rows: [number | string | null, number][] = [
  [0, 0.0], [-0, -0], [0.5, 0.5], [-0.5, -0.5], [9007199254740992, 9007199254740992.0], [Number.MIN_VALUE, Number.MIN_VALUE], [Infinity, Infinity], [-Infinity, -Infinity], [NaN, NaN],
  [null, 0.0], ["", 0.0], ["-0", -0], ["\u00a0+1.5\u2028", 1.5], ["0x20", 32.0], ["0o11", 9.0], ["0b101", 5.0], ["1_000", NaN], ["-0x20", NaN], ["Infinity", Infinity], ["-.5e2", -50.0],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function convert(index: number, value: number | string | null): number {

  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  let result: number;
  if (typeof value === "string") { seen.push("string"); result = rows[index][1]; }
  else if (value === null) { seen.push("null"); result = rows[index][1]; }
  else { seen.push("number"); result = rows[index][1]; }
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const result = convert(index, row[0]); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[0] === null ? "null" : typeof row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
