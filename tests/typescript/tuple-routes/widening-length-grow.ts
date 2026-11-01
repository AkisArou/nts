/*---
description: "Growing a tuple through an array alias creates holes while preserving its original slots."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions, ts-unsound-covariant-array, ts-tuples]
---*/
// [number,string] crosses an array length writer, growing to 3, 4 and 5; Node keeps the first two payloads and creates absent slots that read undefined.
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
function grow(value: (number | string)[], count: number): void { value.length = count; }
function read(value: [number, string], index: number): unknown { return value[index]; }
for (const row of rows) {
  const value: [number, string] = [row.num, row.text]; const count = row.limit + 3; grow(value, count);
  same(Array.isArray(value), true); same(value.length, count);
  for (let index = 0; index < count; index++) {
    const expected = index === 0 ? row.num : index === 1 ? row.text : undefined;
    same(read(value, index), expected); same(Object.hasOwn(value, index), index < 2); same(index in value, index < 2);
  }
  same(value[0], row.num); same(value[1], row.text);
}
