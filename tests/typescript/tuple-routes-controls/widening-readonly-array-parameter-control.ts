/*---
description: "Control for widening-readonly-array-parameter; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-readonly]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. The parameter accepts the same readonly named-slot record, retaining all fields and explicit logical length/array status.
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
interface SlotRecord { readonly first: number; readonly second: string; readonly third: WritePoint; readonly count: number; readonly array: boolean; }
function inspect(value: SlotRecord, row: WriteRow): void {
  same(value.array, true); same(value.count, 3);
  same(value.first, row.num); same(value.second, row.text); same(value.third, row.point);
}
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: row.point, count: 3, array: true };
  inspect(value, row);
  same(value.array, true); same(value.count, 3);
  same(value.first, row.num); same(value.second, row.text); same(value.third, row.point);
}
