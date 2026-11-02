/*---
description: "An interface field is read by cosine and overwritten with its exact unit or NaN result, which the caller reads back."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-interfaces]
---*/
// An interface field logs its input and replacement; Node maps either zero to one and NaN or either infinity to NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 1 }, { input: -0, expected: 1 },
  { input: NaN, expected: NaN }, { input: Infinity, expected: NaN },
  { input: -Infinity, expected: NaN },
];
interface TrigField { value: number }
function trig(source: TrigField, position: number, log: unknown[]): number {
  const input: number = source.value; same(input, rows[position].input); log.push("input", input);
  const result: number = Math.cos(input); source.value = result; log.push("stored", source.value); return result;
}
let position = 0;
for (const row of rows) {
  const source: TrigField = { value: 1 }, log: unknown[] = []; source.value = row.input;
  const result: number = trig(source, position, log); same(result, row.expected); same(source.value, row.expected);
  exact(log, ["input", row.input, "stored", row.expected]); position++;
}
same(position, rows.length);
