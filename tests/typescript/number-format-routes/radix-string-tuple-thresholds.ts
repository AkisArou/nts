/*---
description: "A readonly tuple carries unique decimal threshold values into String."
features: [ts-number-format-routes, ts-number-format-route-radix, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-strings, ts-tuples, ts-readonly, ts-type-aliases, ts-conversions]
---*/
// A readonly tuple logs its number and String result; Node changes notation at 1e-6 and 1e21 and spells either zero "0".
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type FormatRow = readonly [number, string];
const rows: FormatRow[] = [
  [0, "0"], [-0, "0"],
  [1e-7, "1e-7"], [9.999999999999998e-8, "9.999999999999998e-8"],
  [1.0000000000000001e-7, "1.0000000000000001e-7"], [9.99999e-7, "9.99999e-7"],
  [1e-6, "0.000001"], [1.000001e-6, "0.000001000001"],
  [-1e-7, "-1e-7"], [-1e-6, "-0.000001"],
  [999999999999999868928, "999999999999999900000"], [1e21, "1e+21"],
  [1000000000000000131072, "1.0000000000000001e+21"], [-1e21, "-1e+21"],
  [1e22, "1e+22"], [-1e22, "-1e+22"],
  [NaN, "NaN"], [Infinity, "Infinity"],
  [-Infinity, "-Infinity"],
];
function route(source: readonly [number, number], position: number, log: unknown[]): string {
  same(source[0], position); const input: number = source[1]; same(input, rows[position][0]); log.push("tuple", source[0], input);
  const text: string = String(input); log.push("text", text); return text;
}
let position = 0;
for (const row of rows) {
  const source: readonly [number, number] = [position, row[0]], log: unknown[] = [];
  const text = route(source, position, log); same(text, row[1]); same(source[1], row[0]);
  exact(log, ["tuple", position, row[0], "text", row[1]]); position++;
}
same(position, rows.length);
