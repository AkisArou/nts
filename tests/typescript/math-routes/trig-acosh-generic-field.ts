/*---
description: "A generic numeric field supplies inverse hyperbolic cosine at one, positive infinity and values below one."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-interfaces, ts-generics, ts-generic-constraints]
---*/
// A generic numeric field logs input and inverse-hyperbolic-cosine result; Node maps one to positive zero and values below one to NaN, preserving +Infinity and NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 1, expected: 0 }, { input: Infinity, expected: Infinity },
  { input: NaN, expected: NaN }, { input: 0, expected: NaN },
  { input: -0, expected: NaN }, { input: 0.9999999999999999, expected: NaN },
  { input: 0.5, expected: NaN }, { input: -1, expected: NaN },
  { input: -9007199254740991, expected: NaN }, { input: -Infinity, expected: NaN },
];
interface TrigBox<T> { value: T }
function trig<T extends number>(box: TrigBox<T>, position: number, log: unknown[]): number {
  const input: T = box.value; same(input, rows[position].input); log.push("input", input);
  const result: number = Math.acosh(input); log.push("result", result); return result;
}
let position = 0;
for (const row of rows) {
  const box: TrigBox<number> = { value: row.input }, log: unknown[] = [], result: number = trig(box, position, log);
  same(result, row.expected); same(box.value, row.input); exact(log, ["input", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
