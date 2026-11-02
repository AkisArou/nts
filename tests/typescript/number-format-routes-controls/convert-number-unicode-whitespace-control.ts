/*---
description: Number consumes every ECMAScript whitespace and line terminator through a string parameter while rejecting excluded spaces with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator]
---*/
// Unicode whitespace strings cross a declared string parameter; node returns exact signed zero, finite values or NaN in the whole log. The control reads the result table.
const rows: [string, number][] = [
  ["", 0.0], ["\t\u000b\f \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff\n\r\u2028\u2029", 0.0], ["\t-0\t", -0],
  ["\u000b-0\u000b", -0], ["\f-0\f", -0], [" -0 ", -0], ["\u00a0-0\u00a0", -0], ["\u1680-0\u1680", -0], ["\u2000-0\u2000", -0], ["\u2001-0\u2001", -0], ["\u2002-0\u2002", -0],
  ["\u2003-0\u2003", -0], ["\u2004-0\u2004", -0], ["\u2005-0\u2005", -0], ["\u2006-0\u2006", -0], ["\u2007-0\u2007", -0], ["\u2008-0\u2008", -0], ["\u2009-0\u2009", -0],
  ["\u200a-0\u200a", -0], ["\u202f-0\u202f", -0], ["\u205f-0\u205f", -0], ["\u3000-0\u3000", -0], ["\ufeff-0\ufeff", -0], ["\n-0\n", -0], ["\r-0\r", -0], ["\u2028-0\u2028", -0],
  ["\u2029-0\u2029", -0], ["\u200b12", NaN], ["\u008512", NaN], ["\u180e12", NaN], ["\u206012", NaN], ["\ufeff12.5\u3000", 12.5], ["12\u2000.5", NaN],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
function convert(index: number, value: string): number {

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
