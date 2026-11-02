/*---
description: "An interface method preserves decimal carries and signed exponential exponents."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-this, ts-this-parameter]
---*/
// An interface method reads receiver fields; the ordered text log includes exponent carries, zero exponents and subnormal or maximal exponents.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string][] = [
  [9.5, 0, "1e+1"], [-9.5, 0, "-1e+1"],
  [99.5, 1, "1.0e+2"], [-99.5, 1, "-1.0e+2"],
  [999.5, 2, "1.00e+3"], [-999.5, 2, "-1.00e+3"],
  [9.999999e-7, 0, "1e-6"], [9.999999e-7, 6, "9.999999e-7"],
  [-9.999999e-7, 0, "-1e-6"], [-9.999999e-7, 6, "-9.999999e-7"],
  [1e-6, 0, "1e-6"], [1e-7, 0, "1e-7"],
  [1e20, 0, "1e+20"], [1e21, 0, "1e+21"],
  [Number.MIN_VALUE, 0, "5e-324"], [Number.MIN_VALUE, 1, "4.9e-324"],
  [-Number.MIN_VALUE, 0, "-5e-324"], [1e-323, 0, "1e-323"],
  [Number.MAX_VALUE, 0, "2e+308"], [Number.MAX_VALUE, 16, "1.7976931348623157e+308"],
  [-Number.MAX_VALUE, 0, "-2e+308"], [0, 0, "0e+0"],
  [-0, 3, "0.000e+0"],
];
interface Formatter { value: number; digits: number; render(position: number, log: unknown[]): string; }
function render(this: Formatter, position: number, log: unknown[]): string {
  const value = this.value, digits = this.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  const text = value.toExponential(digits); log.push("text", text); return text;
}
function throughInterface(view: Formatter, position: number, log: unknown[]): string { return view.render(position, log); }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], view: Formatter = { value: row[0], digits: row[1], render };
  const text = throughInterface(view, position, log); same(view.value, row[0]); same(view.digits, row[1]); same(text, row[2]); assert.sameValue(text, row[2]); exact(log, ["input", row[0], row[1], "text", row[2]]);
}
