/*---
description: "A declared number return feeds inverse tangent only its exact signed-zero and NaN inputs."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects]
---*/
// A declared number return logs its operand and inverse-tangent result; Node preserves the tested signed zeros and NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: NaN, expected: NaN },
];
function relay(value: number, log: unknown[]): number { log.push("return", value); return value; }
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], input: number = relay(row.input, log); same(input, row.input);
  const result: number = Math.atan(input); log.push("result", result); same(result, row.expected); same(input, row.input);
  exact(log, ["return", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
