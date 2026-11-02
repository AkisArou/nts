/*---
description: "An interface request preserves precision range errors and nonfinite receiver precedence."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-errors, ts-instanceof, ts-unions]
---*/
// An interface request logs raw receiver and digit values; finite range failures and nonfinite text returns remain distinct after truncation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number, string | null][] = [
  [1, 0, null], [-0, -0, null],
  [2.5, NaN, null], [1, -0.9, null],
  [-1, -1, null], [0, -Infinity, null],
  [1, Infinity, null], [0, 101, null],
  [Number.MIN_VALUE, 101, null], [Number.MAX_VALUE, 101, null],
  [1, 0.999, null], [1, 1, "1"],
  [2.5, 1.9, "3"], [2.5, 2.9, "2.5"],
  [1, 100, "1.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"], [0, 100.9, "0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [-0, 100, "0.000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"], [1, 99.9, "1.00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"],
  [NaN, 0, "NaN"], [NaN, 101, "NaN"],
  [NaN, Infinity, "NaN"], [Infinity, 0, "Infinity"],
  [Infinity, 101, "Infinity"], [Infinity, -Infinity, "Infinity"],
  [-Infinity, NaN, "-Infinity"], [-Infinity, 101, "-Infinity"],
  [-Infinity, Infinity, "-Infinity"],
];
interface FormatInput { value: number; digits: number; }
function render(view: FormatInput, position: number, log: unknown[]): string {
  const value = view.value, digits = view.digits; same(value, rows[position][0]); same(digits, rows[position][1]); log.push("input", value, digits);
  try { const text = value.toPrecision(digits); log.push("text", text); return text; }
  catch (error) { assert.sameValue(error instanceof RangeError, true); log.push("throw", error instanceof RangeError); throw error; }
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], view: FormatInput = { value: row[0], digits: row[1] }, log: unknown[] = []; let text: string | null = null;
  if (row[2] === null) assert.throws(RangeError, () => { text = render(view, position, log); });
  else text = render(view, position, log);
  same(view.value, row[0]); same(view.digits, row[1]); same(text, row[2]); assert.sameValue(text, row[2]);
  exact(log, row[2] === null ? ["input", row[0], row[1], "throw", true] : ["input", row[0], row[1], "text", row[2]]);
}
