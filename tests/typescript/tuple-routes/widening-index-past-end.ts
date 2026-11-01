/*---
description: "An indexed write past a tuple creates a hole and a new identity-bearing slot."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions, ts-unsound-covariant-array, ts-tuples]
---*/
// [number,string] crosses a union-array writer that stores a reference at index 3; Node returns four elements with a hole at 2 and the exact reference at 3.
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
function extend(value: (number | string | WritePoint)[], point: WritePoint): void { value[3] = point; }
function read(value: [number, string], index: number): unknown { return value[index]; }
for (const row of rows) {
  const value: [number, string] = [row.num, row.text]; extend(value, row.point);
  same(Array.isArray(value), true); same(value.length, 4);
  for (const index of [0, 1, 2, 3]) {
    const expected = index === 0 ? row.num : index === 1 ? row.text : index === 2 ? undefined : row.point;
    same(read(value, index), expected); same(Object.hasOwn(value, index), index !== 2); same(index in value, index !== 2);
  }
  same(value[0], row.num); same(value[1], row.text);
}
