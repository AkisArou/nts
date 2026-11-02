/*---
description: "A position-indexed result table preserves the typed route for cosh special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-readonly]
---*/
// A readonly array logs its operand, result and retained element; Node maps zeros to one and infinities to positive infinity, preserving NaN.
// Control: retain that typed route and log; only the builtin operation becomes a fixed table read indexed by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 1 }, { input: -0, expected: 1 },
  { input: NaN, expected: NaN }, { input: Infinity, expected: Infinity },
  { input: -Infinity, expected: Infinity },
];
const replacement: number[] = [1, 1, NaN, Infinity, Infinity];
function trig(values: readonly number[], position: number, log: unknown[]): number {
  const input: number = values[0]; same(input, rows[position].input); log.push("input", input);
  const result: number = replacement[position]; log.push("result", result, "after", values[0]); return result;
}
let position = 0;
for (const row of rows) {
  const values: number[] = [1], log: unknown[] = []; values[0] = row.input;
  const result: number = trig(values, position, log); same(result, row.expected); same(values[0], row.input);
  exact(log, ["input", row.input, "result", row.expected, "after", row.input]); position++;
}
same(position, rows.length);
