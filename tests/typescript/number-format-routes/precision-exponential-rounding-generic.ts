/*---
description: "Constrained generic records preserve exponential ties and exact binary rounding."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints]
---*/
// Two generic record shapes carry raw numbers and fraction counts; returned owners and text expose ties, wide integers and binary rounding.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string][] = [
  [0, 0, "0e+0"], [-0, 1, "0.0e+0"],
  [1.25, 1, "1.3e+0"], [-1.25, 1, "-1.3e+0"],
  [1.125, 2, "1.13e+0"], [-1.125, 2, "-1.13e+0"],
  [1.375, 2, "1.38e+0"], [-1.375, 2, "-1.38e+0"],
  [2.5, 0, "3e+0"], [-2.5, 0, "-3e+0"],
  [2.55, 1, "2.5e+0"], [-2.55, 1, "-2.5e+0"],
  [2.675, 2, "2.67e+0"], [-2.675, 2, "-2.67e+0"],
  [1.005, 2, "1.00e+0"], [-1.005, 2, "-1.00e+0"],
  [0.1, 17, "1.00000000000000006e-1"], [0.3, 17, "2.99999999999999989e-1"],
  [9007199254740991, 14, "9.00719925474099e+15"], [9007199254740992, 15, "9.007199254740992e+15"],
  [9007199254740994, 15, "9.007199254740994e+15"], [1000000000000000128, 18, "1.000000000000000128e+18"],
  [NaN, 6, "NaN"], [Infinity, 6, "Infinity"],
  [-Infinity, 6, "-Infinity"],
];
interface FormatInput { value: number; digits: number; }
function render<T extends FormatInput>(view: T, position: number, log: unknown[]): [T, string] {
  const value = view.value, digits = view.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  const text = value.toExponential(digits); log.push("text", text); return [view, text];
}
function check<T extends FormatInput>(view: T, position: number): void {
  const log: unknown[] = [], output = render(view, position, log), row = rows[position];
  same(output[0], view); same(output[0].value, row[0]); same(output[0].digits, row[1]); same(output[1], row[2]); assert.sameValue(output[1], row[2]); exact(log, ["input", row[0], row[1], "text", row[2]]);
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position]; check({ value: row[0], digits: row[1] }, position); check({ label: "tagged", digits: row[1], value: row[0] }, position);
}
