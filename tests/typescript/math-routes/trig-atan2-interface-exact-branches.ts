/*---
description: "An interface carries both atan2 operands through every exact signed-zero branch and NaN in either coordinate."
features: [ts-math-routes, ts-math-route-trigonometry, ts-functions, ts-arrays, ts-iteration, ts-numbers, ts-unknown, ts-typeof-operator, ts-type-aliases, ts-objects, ts-interfaces]
---*/
// An interface logs y, x and atan2 result; on the covered exact branches Node gives zero with the sign of y, while NaN in either coordinate gives NaN.
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
type TrigRow = { y: number; x: number; expected: number };
const rows: TrigRow[] = [
  { y: 0, x: 0, expected: 0 }, { y: -0, x: 0, expected: -0 },
  { y: 0, x: 1, expected: 0 }, { y: -0, x: 1, expected: -0 },
  { y: 0, x: 5e-324, expected: 0 }, { y: -0, x: 5e-324, expected: -0 },
  { y: 0, x: Infinity, expected: 0 }, { y: -0, x: Infinity, expected: -0 },
  { y: 1, x: Infinity, expected: 0 }, { y: -1, x: Infinity, expected: -0 },
  { y: 5e-324, x: Infinity, expected: 0 }, { y: -5e-324, x: Infinity, expected: -0 },
  { y: 4294967296, x: Infinity, expected: 0 }, { y: -4294967296, x: Infinity, expected: -0 },
  { y: 1.7976931348623157e308, x: Infinity, expected: 0 }, { y: -1.7976931348623157e308, x: Infinity, expected: -0 },
  { y: NaN, x: 0, expected: NaN }, { y: NaN, x: -0, expected: NaN },
  { y: NaN, x: 1, expected: NaN }, { y: NaN, x: -1, expected: NaN },
  { y: NaN, x: Infinity, expected: NaN }, { y: NaN, x: -Infinity, expected: NaN },
  { y: 0, x: NaN, expected: NaN }, { y: -0, x: NaN, expected: NaN },
  { y: 1, x: NaN, expected: NaN }, { y: -1, x: NaN, expected: NaN },
  { y: Infinity, x: NaN, expected: NaN }, { y: -Infinity, x: NaN, expected: NaN },
  { y: NaN, x: NaN, expected: NaN },
];
interface TrigPoint { y: number; x: number }
function trig(point: TrigPoint, position: number, log: unknown[]): number {
  const y: number = point.y, x: number = point.x; same(y, rows[position].y); same(x, rows[position].x); log.push("y", y, "x", x);
  const result: number = Math.atan2(y, x); log.push("result", result); return result;
}
let position = 0;
for (const row of rows) {
  const point: TrigPoint = { y: row.y, x: row.x }, log: unknown[] = [], result: number = trig(point, position, log);
  same(result, row.expected); same(point.y, row.y); same(point.x, row.x);
  exact(log, ["y", row.y, "x", row.x, "result", row.expected]); position++;
}
same(position, rows.length);
