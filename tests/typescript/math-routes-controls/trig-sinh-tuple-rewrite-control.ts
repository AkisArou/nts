/*---
description: "A position-indexed result table preserves the typed route for sinh special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-tuples]
---*/
// A one-number tuple logs its input and rewritten result; Node preserves signed zeros, either infinity and NaN.
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
function trig(slot: [number], position: number, log: unknown[]): number {
  const input: number = slot[0]; same(input, rows[position].input); log.push("input", input);
  const result: number = replacement[position]; slot[0] = result; log.push("stored", slot[0]); return result;
}
let position = 0;
for (const row of rows) {
  const slot: [number] = [1], log: unknown[] = []; slot[0] = row.input;
  const result: number = trig(slot, position, log); same(result, row.expected); same(slot[0], row.expected);
  exact(log, ["input", row.input, "stored", row.expected]); position++;
}
same(position, rows.length);
