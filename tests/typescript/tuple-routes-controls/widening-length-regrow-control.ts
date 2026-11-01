/*---
description: "Control for widening-length-regrow; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-unions, ts-null-undefined, ts-expressions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. Truncation clears named fields and presence; regrowth updates count without restoring those fields or presence.
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
interface SlotRecord { first: number | undefined; second: string | undefined; third: WritePoint | undefined; present: boolean; count: number; array: boolean; }
function resize(value: SlotRecord, count: number): void { if (count === 0) { value.first = undefined; value.second = undefined; value.third = undefined; value.present = false; } value.count = count; }
function read(value: SlotRecord, index: number): unknown { if (index === 0) return value.first; if (index === 1) return value.second; return value.third; }
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: row.point, present: true, count: 3, array: true };
  same(value.first, row.num); same(value.second, row.text); same(value.third, row.point);
  for (const count of [0, 3]) {
    resize(value, count); same(value.array, true); same(value.count, count);
    for (const index of [0, 1, 2]) { same(read(value, index), undefined); same(value.present, false); same(value.present, false); }
    same(value.first, undefined); same(value.second, undefined); same(value.third, undefined);
  }
}
