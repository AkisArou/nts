/*---
description: "A shortened array alias removes tuple slots instead of retaining their former payloads."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions, ts-unsound-covariant-array, ts-tuples]
---*/
// [number,string,WritePoint] is shortened through a union-array parameter to lengths 0, 1 and 2; Node returns undefined and no own slot for each removed position.
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
function shorten(value: (number | string | WritePoint)[], count: number): void { value.length = count; }
function read(value: [number, string, WritePoint], index: number): unknown { return value[index]; }
for (const row of rows) {
  const value: [number, string, WritePoint] = [row.num, row.text, row.point]; shorten(value, row.limit);
  same(Array.isArray(value), true); same(value.length, row.limit);
  for (const index of [0, 1, 2]) {
    const expected = index >= row.limit ? undefined : index === 0 ? row.num : index === 1 ? row.text : row.point;
    same(read(value, index), expected); same(Object.hasOwn(value, index), index < row.limit); same(index in value, index < row.limit);
  }
  same(value[0], row.limit > 0 ? row.num : undefined); same(value[1], row.limit > 1 ? row.text : undefined); same(value[2], undefined);
}
