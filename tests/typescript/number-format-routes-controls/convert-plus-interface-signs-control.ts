/*---
description: Unary plus consumes a string returned by an interface method with exact sign and exponent rules with the same typed route and a position-indexed result table.
features: [ts-number-format-routes, ts-number-format-route-string-to-number, ts-numbers, ts-strings, ts-conversions, ts-arrays, ts-tuples, ts-functions, ts-typeof-operator, ts-interfaces, ts-class, ts-class-fields]
---*/
// Two class layouts supply strings through an interface method; node logs accepted signs, signed zeros and rejected split signs. The control reads the result table.
const rows: [string, number][] = [
  ["+", NaN], ["-", NaN], ["--1", NaN], ["+-1", NaN], ["-+1", NaN], ["++1", NaN], ["- 1", NaN], ["+\n1", NaN], [" \ufeff+0\r\n", 0.0], ["-00", -0], ["-0e309", -0], ["-0.000e-9999", -0],
  ["+00.0", 0.0], ["1e+0003", 1000.0], ["1e-0003", 0.001], [" \u2028-1.5\u2029", -1.5], ["0xFF", 255.0], ["-Infinity", -Infinity], ["+Infinity", Infinity], ["infinity", NaN], ["0", 0.0],
];
const seen: (number | string | null)[] = [], expectedLog: (number | string | null)[] = [];
interface NumericText { read(): string; }
class LeadingText implements NumericText { text: string = ""; padding: number = 7; read(): string { return this.text; } }
class TrailingText implements NumericText { padding: number = 7; text: string = ""; read(): string { return this.text; } }
function convert(index: number, input: NumericText): number {
  const value: string = input.read();
  assert.sameValue(Object.is(value, rows[index][0]), true); assert.sameValue(typeof value, typeof rows[index][0]);
  seen.push(value);
  const result: number = rows[index][1];
  seen.push(result); return result;
}
for (let index = 0; index < rows.length; index++) {
  const row = rows[index];
  const input = index % 2 === 0 ? new LeadingText() : new TrailingText(); input.text = row[0];
  const result = convert(index, input); assert.sameValue(Object.is(result, row[1]), true); assert.sameValue(typeof result, "number");
  expectedLog.push(row[0], row[1]);
}
assert.compareArray(seen, expectedLog);
