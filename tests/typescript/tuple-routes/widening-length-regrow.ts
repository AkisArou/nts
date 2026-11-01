/*---
description: "Regrowing a truncated tuple must not resurrect the payloads removed through its array alias."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions, ts-unsound-covariant-array, ts-tuples]
---*/
// [number,string,WritePoint] is truncated to zero then regrown through the same array parameter; Node leaves every former slot absent and undefined at both stages.
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
function resize(value: (number | string | WritePoint)[], count: number): void { value.length = count; }
function read(value: [number, string, WritePoint], index: number): unknown { return value[index]; }
for (const row of rows) {
  const value: [number, string, WritePoint] = [row.num, row.text, row.point];
  same(value[0], row.num); same(value[1], row.text); same(value[2], row.point);
  for (const count of [0, 3]) {
    resize(value, count); same(Array.isArray(value), true); same(value.length, count);
    for (const index of [0, 1, 2]) { same(read(value, index), undefined); same(Object.hasOwn(value, index), false); same(index in value, false); }
    same(value[0], undefined); same(value[1], undefined); same(value[2], undefined);
  }
}
