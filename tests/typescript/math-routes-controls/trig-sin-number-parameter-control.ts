/*---
description: "A position-indexed result table preserves the typed route for sin special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects]
---*/
// A number parameter and return log the operand and result; Node retains signed zeros and NaN, mapping either infinity to NaN.
// Control: retain that typed route and log; only the builtin operation becomes a fixed table read indexed by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: NaN, expected: NaN }, { input: Infinity, expected: NaN },
  { input: -Infinity, expected: NaN },
];
const replacement: number[] = [0, -0, NaN, NaN, NaN];
function trig(value: number, position: number, log: unknown[]): number {
  same(value, rows[position].input); log.push("input", value);
  const result: number = replacement[position]; log.push("result", result);
  same(value, rows[position].input); return result;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], result: number = trig(row.input, position, log);
  same(result, row.expected); exact(log, ["input", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
