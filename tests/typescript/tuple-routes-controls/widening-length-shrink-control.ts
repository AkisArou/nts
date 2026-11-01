/*---
description: "Control for widening-length-shrink; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. The record writer clears each removed named payload to explicit undefined and changes count; count determines logical presence.
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
interface SlotRecord { first: number | undefined; second: string | undefined; third: WritePoint | undefined; count: number; array: boolean; }
function shorten(value: SlotRecord, count: number): void { if (count < 1) value.first = undefined; if (count < 2) value.second = undefined; if (count < 3) value.third = undefined; value.count = count; }
function read(value: SlotRecord, index: number): unknown { if (index === 0) return value.first; if (index === 1) return value.second; return value.third; }
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: row.point, count: 3, array: true }; shorten(value, row.limit);
  same(value.array, true); same(value.count, row.limit);
  for (const index of [0, 1, 2]) {
    const expected = index >= row.limit ? undefined : index === 0 ? row.num : index === 1 ? row.text : row.point;
    same(read(value, index), expected); same(index < value.count, index < row.limit); same(index < value.count, index < row.limit);
  }
  same(value.first, row.limit > 0 ? row.num : undefined); same(value.second, row.limit > 1 ? row.text : undefined); same(value.third, undefined);
}
