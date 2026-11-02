/*---
description: "Interface inputs and outputs preserve omitted and explicit undefined exponential digits."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-optional-parameters, ts-iteration]
---*/
// An interface record crosses both call arities; every finite sample has a unique shortest significand and always uses exponent notation.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, string][] = [
  [0, "0e+0"], [-0, "0e+0"],
  [1, "1e+0"], [-1, "-1e+0"],
  [0.125, "1.25e-1"], [-0.125, "-1.25e-1"],
  [1.25, "1.25e+0"], [-1.25, "-1.25e+0"],
  [0.1, "1e-1"], [2.5, "2.5e+0"],
  [10, "1e+1"], [1000, "1e+3"],
  [1e-6, "1e-6"], [1e-7, "1e-7"],
  [-1e-7, "-1e-7"], [1e20, "1e+20"],
  [1e21, "1e+21"], [-1e21, "-1e+21"],
  [NaN, "NaN"], [Infinity, "Infinity"],
  [-Infinity, "-Infinity"],
];
interface FormatInput { value: number; }
interface FormatOutput { source: FormatInput; text: string; }
function render(view: FormatInput, position: number, omitted: boolean, log: unknown[], digits?: number): FormatOutput {
  const value = view.value; same(value, rows[position][0]); same(digits, undefined); log.push("input", value, omitted, digits);
  const text = omitted ? value.toExponential() : value.toExponential(digits); log.push("text", text); return { source: view, text };
}
for (let position = 0; position < rows.length; position++) for (const omitted of [true, false]) {
  const row = rows[position], view: FormatInput = { value: row[0] }, log: unknown[] = [];
  const output = omitted ? render(view, position, omitted, log) : render(view, position, omitted, log, undefined);
  same(output.source, view); same(output.source.value, row[0]); same(output.text, row[1]); assert.sameValue(output.text, row[1]); exact(log, ["input", row[0], omitted, undefined, "text", row[1]]);
}
