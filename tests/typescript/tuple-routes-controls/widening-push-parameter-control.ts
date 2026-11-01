/*---
description: "Control for widening-push-parameter; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-expressions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. The writer assigns third/fourth fields and increments count; bounded index dispatch and count replace tuple access and presence.
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
interface SlotRecord { first: number; second: string; third: number; fourth: string; count: number; array: boolean; }
function append(value: SlotRecord, row: WriteRow): void { value.third = row.extra; value.fourth = row.text + "!"; value.count += 2; }
function read(value: SlotRecord, index: number): unknown { if (index === 0) return value.first; if (index === 1) return value.second; if (index === 2) return value.third; return value.fourth; }
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: 99, fourth: "stale", count: 2, array: true };
  append(value, row);
  same(value.array, true); same(value.count, 4);
  for (const index of [0, 1, 2, 3]) {
    const expected = index === 0 ? row.num : index === 1 ? row.text : index === 2 ? row.extra : row.text + "!";
    same(read(value, index), expected); same(index < value.count, true); same(index < value.count, true);
  }
  same(value.first, row.num); same(value.second, row.text);
}
