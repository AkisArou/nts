/*---
description: "A declared readonly tuple passes to a readonly array parameter with all slot values intact."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-readonly, ts-tuples, ts-unions]
---*/
// readonly [number,string,WritePoint] crosses a readonly union-array parameter; Node retains array nature, length, exact slot types and reference identity.
interface WritePoint { id: number; }
interface WriteRow { num: number; text: string; extra: number; point: WritePoint; next: WritePoint; limit: number; }
const firstPoint: WritePoint = { id: 7 }, nextPoint: WritePoint = { id: 11 };
const rows: WriteRow[] = [
  { num: -0, text: "", extra: NaN, point: firstPoint, next: nextPoint, limit: 0 },
  { num: NaN, text: "tail", extra: -0, point: nextPoint, next: firstPoint, limit: 1 },
  { num: 2.5, text: "7", extra: -17, point: firstPoint, next: nextPoint, limit: 2 }
];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function inspect(value: readonly (number | string | WritePoint)[], row: WriteRow): void {
  same(Array.isArray(value), true); same(value.length, 3);
  same(value[0], row.num); same(value[1], row.text); same(value[2], row.point);
}
for (const row of rows) {
  const value: readonly [number, string, WritePoint] = [row.num, row.text, row.point];
  inspect(value, row);
  same(Array.isArray(value), true); same(value.length, 3);
  same(value[0], row.num); same(value[1], row.text); same(value[2], row.point);
}
