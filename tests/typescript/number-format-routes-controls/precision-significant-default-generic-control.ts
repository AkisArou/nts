/*---
description: "Control for precision-significant-default-generic; A generic input and optional precision distinguish omitted and explicit undefined calls."
features: [ts-number-format-routes, ts-number-format-route-precision-exponent, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-conversions, ts-unknown, ts-typeof-operator, ts-interfaces, ts-objects, ts-generics, ts-generic-constraints, ts-optional-parameters, ts-iteration]
---*/
// A generic record crosses both call arities; omitted and undefined precision return the same uniquely determined shortest decimal text. The control preserves the route and selects the result by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, string][] = [
  [0, "0"], [-0, "0"],
  [1, "1"], [-1, "-1"],
  [0.125, "0.125"], [-0.125, "-0.125"],
  [1.25, "1.25"], [-1.25, "-1.25"],
  [0.1, "0.1"], [2.5, "2.5"],
  [10, "10"], [1000, "1000"],
  [1e-6, "0.000001"], [1e-7, "1e-7"],
  [-1e-7, "-1e-7"], [1e20, "100000000000000000000"],
  [1e21, "1e+21"], [-1e21, "-1e+21"],
  [NaN, "NaN"], [Infinity, "Infinity"],
  [-Infinity, "-Infinity"],
];
interface FormatInput { value: number; }
function render<T extends FormatInput>(view: T, position: number, omitted: boolean, log: unknown[], digits?: number): [T, string] {
  const value = view.value; same(value, rows[position][0]); same(digits, undefined); log.push("input", value, omitted, digits);
  const text = omitted ? rows[position][1] : rows[position][1]; log.push("text", text); return [view, text];
}
for (let position = 0; position < rows.length; position++) for (const omitted of [true, false]) {
  const row = rows[position], view = { value: row[0], label: "default" }, log: unknown[] = [];
  const output = omitted ? render(view, position, omitted, log) : render(view, position, omitted, log, undefined);
  same(output[0], view); same(output[0].value, row[0]); same(output[1], row[1]); assert.sameValue(output[1], row[1]); exact(log, ["input", row[0], omitted, undefined, "text", row[1]]);
}
