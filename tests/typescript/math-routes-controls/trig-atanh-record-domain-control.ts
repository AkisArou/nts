/*---
description: "A position-indexed result table preserves the typed route for atanh special values."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-record, ts-strings]
---*/
// A Record entry logs its key, operand and replacement; Node preserves signed zeros, maps signed units to signed infinities, and returns NaN outside [-1, 1] or for NaN.
// Control: retain that typed route and log; only the builtin operation becomes a fixed table read indexed by input position.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: 1, expected: Infinity }, { input: -1, expected: -Infinity },
  { input: NaN, expected: NaN }, { input: 1.0000000000000002, expected: NaN },
  { input: -1.0000000000000002, expected: NaN }, { input: 2, expected: NaN },
  { input: -2, expected: NaN }, { input: 9007199254740991, expected: NaN },
  { input: -9007199254740991, expected: NaN }, { input: Infinity, expected: NaN },
  { input: -Infinity, expected: NaN },
];
const replacement: number[] = [0, -0, Infinity, -Infinity, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
function trig(source: Record<string, number>, key: string, position: number, log: unknown[]): number {
  const input: number = source[key]; same(input, rows[position].input); log.push("key", key, "input", input);
  const result: number = replacement[position]; source[key] = result; log.push("stored", source[key]); return result;
}
let position = 0;
for (const row of rows) {
  const key: string = position % 2 === 0 ? "left" : "right", other: string = key === "left" ? "right" : "left";
  const source: Record<string, number> = { left: 42, right: 42 }, log: unknown[] = []; source[key] = row.input;
  const result: number = trig(source, key, position, log); same(result, row.expected); same(source[key], row.expected); same(source[other], 42);
  exact(log, ["key", key, "input", row.input, "stored", row.expected]); position++;
}
same(position, rows.length);
