/*---
description: "An interface array element retains base-ten logarithm field writes and returned identity."
features: [ts-math-routes, ts-math-route-powers-roots, ts-functions, ts-arrays, ts-tuples, ts-numbers, ts-strings, ts-unknown, ts-typeof-operator, ts-iteration, ts-interfaces, ts-objects]
---*/
// An interface record crosses an array parameter before log10 rewrites its result field; node logs inputs and prescribed results and returns the original record.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const rows: [number, number][] = [
  [0, -Infinity], [-0, -Infinity], [1, 0], [Infinity, Infinity],
  [-Infinity, NaN], [NaN, NaN], [-0.5, NaN], [-1.5, NaN],
  [-2.5, NaN], [-5e-324, NaN], [-2147483649, NaN], [-4503599627370496, NaN],
  [-9007199254740992, NaN], [-1.7976931348623157e+308, NaN],
];
interface LogView { input: number; result: number; }
function compute(views: LogView[], position: number, log: unknown[]): LogView {
  const view = views[0]; log.push("input", view.input); const result = Math.log10(view.input); view.result = result; log.push("computed", view.result); return view;
}
for (let position = 0; position < rows.length; position++) {
  const row = rows[position], original: LogView = { input: row[0], result: 123 }, log: unknown[] = [], output = compute([original], position, log);
  same(output, original); same(output.input, row[0]); same(output.result, row[1]); same(original.result, row[1]); exact(log, ["input", row[0], "computed", row[1]]);
}
