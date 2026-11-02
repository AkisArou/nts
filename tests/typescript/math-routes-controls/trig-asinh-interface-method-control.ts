/*---
description: "A position-indexed result table preserves the typed route for asinh special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-interfaces, ts-closures]
---*/
// An interface method logs its read, numeric operand and result; Node preserves signed zeros, either infinity and NaN.
// Control: retain that typed route and log; only the builtin operation becomes a fixed table read indexed by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: NaN, expected: NaN }, { input: Infinity, expected: Infinity },
  { input: -Infinity, expected: -Infinity },
];
const replacement: number[] = [0, -0, NaN, Infinity, -Infinity];
interface TrigSource { value: number; read(): number }
function trig(source: TrigSource, position: number, log: unknown[]): number {
  const input: number = source.read(); same(input, rows[position].input); log.push("input", input);
  const result: number = replacement[position]; log.push("result", result); return result;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [];
  const source: TrigSource = { value: row.input, read() { log.push("read", this.value); return this.value; } };
  const result: number = trig(source, position, log); same(result, row.expected); same(source.value, row.input);
  exact(log, ["read", row.input, "input", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
