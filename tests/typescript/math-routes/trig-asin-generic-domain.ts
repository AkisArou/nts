/*---
description: "A constrained generic parameter reaches inverse sine with signed zeros, NaN and values strictly outside its domain."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-generics, ts-generic-constraints]
---*/
// A constrained generic logs input and inverse-sine result; Node retains signed zeros and NaN, mapping values outside [-1, 1] to NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: NaN, expected: NaN }, { input: 1.0000000000000002, expected: NaN },
  { input: -1.0000000000000002, expected: NaN }, { input: 2, expected: NaN },
  { input: -2, expected: NaN }, { input: 9007199254740991, expected: NaN },
  { input: -9007199254740991, expected: NaN }, { input: Infinity, expected: NaN },
  { input: -Infinity, expected: NaN },
];
function trig<T extends number>(value: T, position: number, log: unknown[]): number {
  same(value, rows[position].input); log.push("input", value);
  const result: number = Math.asin(value); log.push("result", result); return result;
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], result: number = trig(row.input, position, log);
  same(result, row.expected); exact(log, ["input", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
