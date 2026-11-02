/*---
description: "A returned closure retains the numeric input until tangent runs; its log distinguishes both zero signs and nonfinite results."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// A returned closure logs capture, read and result; Node retains signed zeros and NaN, mapping either infinity to NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { input: number; expected: number };
const rows: TrigRow[] = [
  { input: 0, expected: 0 }, { input: -0, expected: -0 },
  { input: NaN, expected: NaN }, { input: Infinity, expected: NaN },
  { input: -Infinity, expected: NaN },
];
function capture(value: number, position: number, log: unknown[]): () => number {
  log.push("capture", value);
  return () => {
    same(value, rows[position].input); log.push("read", value);
    const result: number = Math.tan(value); log.push("result", result); return result;
  };
}
let position = 0;
for (const row of rows) {
  const log: unknown[] = [], read: () => number = capture(row.input, position, log), result: number = read();
  same(result, row.expected); exact(log, ["capture", row.input, "read", row.input, "result", row.expected]); position++;
}
same(position, rows.length);
