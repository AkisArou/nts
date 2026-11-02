/*---
description: "Control for precision-significant-notation-method; An interface method preserves precision-dependent fixed and exponential notation switches."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-this, ts-this-parameter]
---*/
// An interface method reads receiver fields; its log distinguishes exponent thresholds and carries that change the chosen notation. The control preserves the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string][] = [
  [9.5, 1, "1e+1"], [-9.5, 1, "-1e+1"],
  [99.5, 2, "1.0e+2"], [-99.5, 2, "-1.0e+2"],
  [999.5, 3, "1.00e+3"], [-999.5, 3, "-1.00e+3"],
  [999, 3, "999"], [1000, 3, "1.00e+3"],
  [1000, 4, "1000"], [1e-6, 1, "0.000001"],
  [1e-6, 17, "9.9999999999999995e-7"], [1e-7, 1, "1e-7"],
  [9.999999e-7, 1, "0.000001"], [9.999999e-7, 7, "9.999999e-7"],
  [-9.999999e-7, 1, "-0.000001"], [-9.999999e-7, 7, "-9.999999e-7"],
  [1e20, 20, "1.0000000000000000000e+20"], [1e20, 21, "100000000000000000000"],
  [1e21, 21, "1.00000000000000000000e+21"], [1e21, 22, "1000000000000000000000"],
  [Number.MIN_VALUE, 1, "5e-324"], [-Number.MIN_VALUE, 2, "-4.9e-324"],
  [Number.MAX_VALUE, 1, "2e+308"], [-Number.MAX_VALUE, 2, "-1.8e+308"],
  [0, 4, "0.000"], [-0, 4, "0.000"],
];
interface Formatter { value: number; digits: number; render(position: number, log: unknown[]): string; }
function render(this: Formatter, position: number, log: unknown[]): string {
  const value = this.value, digits = this.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  const text = rows[position][2]; log.push("text", text); return text;
}
function throughInterface(view: Formatter, position: number, log: unknown[]): string { return view.render(position, log); }
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], log: unknown[] = [], view: Formatter = { value: row[0], digits: row[1], render };
  const text = throughInterface(view, position, log); same(view.value, row[0]); same(view.digits, row[1]); same(text, row[2]); assert.sameValue(text, row[2]); exact(log, ["input", row[0], row[1], "text", row[2]]);
}
