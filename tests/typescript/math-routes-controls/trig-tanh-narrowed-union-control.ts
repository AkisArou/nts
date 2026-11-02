/*---
description: "A position-indexed result table preserves the typed route for tanh special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-unions, ts-narrowing, ts-strings]
---*/
// A number-or-string parameter logs the selected branch, operand and result; Node preserves signed zeros and NaN, mapping infinities to signed units.
// Control: retain that typed route and log; only the builtin operation becomes a fixed table read indexed by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number | string; operand: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, operand: 0, expected: 0 }, { input: -0, operand: -0, expected: -0 },
  { input: NaN, operand: NaN, expected: NaN }, { input: Infinity, operand: Infinity, expected: 1 },
  { input: -Infinity, operand: -Infinity, expected: -1 }, { input: "fallback", operand: 0, expected: 0 },
];
const replacement: number[] = [0, -0, NaN, 1, -1, 0];
function trig(value: number | string, position: number, log: unknown[]): number {
  same(value, rows[position].input); let input: number;
  if (typeof value === "number") { input = value; log.push("number", value); }
  else { input = 0; log.push("text", value); }
  same(input, rows[position].operand); log.push("operand", input);
  const result: number = replacement[position]; log.push("result", result); return result;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], result: number = trig(row.input, position, log); same(result, row.expected);
  exact(log, [typeof row.input === "number" ? "number" : "text", row.input, "operand", row.operand, "result", row.expected]); position++;
}
same(position, rows.length);
