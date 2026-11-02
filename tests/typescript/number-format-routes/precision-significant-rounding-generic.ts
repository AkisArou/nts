/*---
description: "Constrained generic records preserve significant-digit ties and exact binary rounding."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints]
---*/
// Two generic record shapes carry raw numbers and dynamic precision; the returned owner and text log exact ties and nearby binary values.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string][] = [
  [0, 1, "0"], [-0, 2, "0.0"],
  [1.25, 2, "1.3"], [-1.25, 2, "-1.3"],
  [1.125, 3, "1.13"], [-1.125, 3, "-1.13"],
  [1.375, 3, "1.38"], [-1.375, 3, "-1.38"],
  [2.5, 1, "3"], [-2.5, 1, "-3"],
  [2.55, 2, "2.5"], [-2.55, 2, "-2.5"],
  [2.675, 3, "2.67"], [-2.675, 3, "-2.67"],
  [1.005, 3, "1.00"], [-1.005, 3, "-1.00"],
  [0.1, 18, "0.100000000000000006"], [0.3, 18, "0.299999999999999989"],
  [9007199254740991, 15, "9.00719925474099e+15"], [9007199254740992, 16, "9007199254740992"],
  [9007199254740994, 16, "9007199254740994"], [1000000000000000128, 19, "1000000000000000128"],
  [NaN, 7, "NaN"], [Infinity, 7, "Infinity"],
  [-Infinity, 7, "-Infinity"],
];
interface FormatInput { value: number; digits: number; }
function render<T extends FormatInput>(view: T, position: number, log: unknown[]): [T, string] {
  const value = view.value, digits = view.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  const text = value.toPrecision(digits); log.push("text", text); return [view, text];
}
function check<T extends FormatInput>(view: T, position: number): void {
  const log: unknown[] = [], output = render(view, position, log), row = rows[position];
  same(output[0], view); same(output[0].value, row[0]); same(output[0].digits, row[1]); same(output[1], row[2]); assert.sameValue(output[1], row[2]); exact(log, ["input", row[0], row[1], "text", row[2]]);
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position]; check({ value: row[0], digits: row[1] }, position); check({ label: "tagged", digits: row[1], value: row[0] }, position);
}
