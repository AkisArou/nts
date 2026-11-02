/*---
description: "Control for precision-exponential-range-generic; A generic request preserves exponential range errors and nonfinite receiver precedence."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints, ts-errors, ts-instanceof, ts-unions]
---*/
// A generic request logs raw receiver and fraction counts; truncation, NaN digits, inclusive bounds and nonfinite early returns stay observable. The control preserves the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string | null][] = [
  [0, -1, null], [-0, -Infinity, null],
  [1, 101, null], [Number.MIN_VALUE, 101, null],
  [Number.MAX_VALUE, Infinity, null], [1, -1.9, null],
  [1, Infinity, null], [1, -0.999, "1e+0"],
  [-0, -0, "0e+0"], [2.5, NaN, "3e+0"],
  [2.5, 0.9, "3e+0"], [2.55, 1.9, "2.5e+0"],
  [1, 99.9, "1.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"], [0, 100, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"],
  [-0, 100.9, "0.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"], [1, 100, "1.0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e+0"],
  [Infinity, -1, "Infinity"], [Infinity, 101, "Infinity"],
  [Infinity, Infinity, "Infinity"], [-Infinity, -Infinity, "-Infinity"],
  [-Infinity, 101, "-Infinity"], [-Infinity, NaN, "-Infinity"],
  [NaN, -1, "NaN"], [NaN, 101, "NaN"],
  [NaN, NaN, "NaN"],
];
interface FormatInput { value: number; digits: number; }
function tableText(position: number): string { const text = rows[position][2]; if (text === null) throw new RangeError(); return text; }
function render<T extends FormatInput>(view: T, position: number, log: unknown[]): string {
  const value = view.value, digits = view.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  try { const text = tableText(position); log.push("text", text); return text; }
  catch (error) { assert.sameValue(error instanceof RangeError, true); log.push("throw", error instanceof RangeError); throw error; }
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], view: FormatInput = { value: row[0], digits: row[1] }, log: unknown[] = []; let text: string | null = null;
  if (row[2] === null) assert.throws(RangeError, () => { text = render(view, position, log); });
  else text = render(view, position, log);
  same(view.value, row[0]); same(view.digits, row[1]); same(text, row[2]); assert.sameValue(text, row[2]);
  exact(log, row[2] === null ? ["input", row[0], row[1], "throw", true] : ["input", row[0], row[1], "text", row[2]]);
}
