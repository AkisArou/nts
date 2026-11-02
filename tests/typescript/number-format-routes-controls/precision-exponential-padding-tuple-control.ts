/*---
description: "Control for precision-exponential-padding-tuple; A generic readonly tuple produces exact exponential padding through 100 fraction digits."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints, ts-readonly]
---*/
// A readonly tuple enters a generic formatter and returns by identity beside exact exponent text with up to 100 fractional places. The control preserves the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string][] = [
  [0, 0, "0e+0"], [-0, 1, "0.0e+0"],
  [1, 2, "1.00e+0"], [-1, 2, "-1.00e+0"],
  [0.125, 5, "1.25000e-1"], [-0.125, 5, "-1.25000e-1"],
  [1.25, 17, "1.25000000000000000e+0"], [1.25, 20, "1.25000000000000000000e+0"],
  [1e21, 25, "1.0000000000000000000000000e+21"], [0.1, 50, "1.00000000000000005551115123125782702118158340454102e-1"],
  [-0.1, 50, "-1.00000000000000005551115123125782702118158340454102e-1"], [0, 99, "0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"],
  [-0, 100, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"], [1, 100, "1.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"],
  [-1, 100, "-1.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"], [0.1, 100, "1.0000000000000000555111512312578270211815834045410156250000000000000000000000000000000000000000000000e-1"],
  [Number.MIN_VALUE, 100, "4.9406564584124654417656879286822137236505980261432476442558568250067550727020875186529983636163599238e-324"], [Number.MAX_VALUE, 100, "1.7976931348623157081452742373170435679807056752584499659891747680315726078002853876058955863276687817e+308"],
];
interface Formatted<T> { source: T; text: string; }
function render<T extends readonly [number, number]>(source: T, position: number, log: unknown[]): Formatted<T> {
  const value = source[0], digits = source[1]; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  const text = rows[position][2]; log.push("text", text); return { source, text };
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], source: readonly [number, number] = [row[0], row[1]], log: unknown[] = [], output = render(source, position, log);
  same(output.source, source); same(output.source[0], row[0]); same(output.source[1], row[1]); same(output.text, row[2]); assert.sameValue(output.text, row[2]); exact(log, ["input", row[0], row[1], "text", row[2]]);
}
