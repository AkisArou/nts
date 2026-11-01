/*---
description: "Control for widening-length-grow; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-expressions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. The record retains its first/second fields and explicit missing fields; the writer changes only count and recorded present positions remain the first two.
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
interface SlotRecord { first: number; second: string; third: undefined; fourth: undefined; fifth: undefined; presentCount: number; count: number; array: boolean; }
function grow(value: SlotRecord, count: number): void { value.count = count; }
function read(value: SlotRecord, index: number): unknown { if (index === 0) return value.first; if (index === 1) return value.second; if (index === 2) return value.third; if (index === 3) return value.fourth; return value.fifth; }
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: undefined, fourth: undefined, fifth: undefined, presentCount: 2, count: 2, array: true }; const count = row.limit + 3; grow(value, count);
  same(value.array, true); same(value.count, count);
  for (let index = 0; index < count; index++) {
    const expected = index === 0 ? row.num : index === 1 ? row.text : undefined;
    same(read(value, index), expected); same(index < value.presentCount, index < 2); same(index < value.presentCount, index < 2);
  }
  same(value.first, row.num); same(value.second, row.text);
}
