/*---
description: "Control for widening-index-class-field; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-unions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. The class holds one record from construction; its first/second fields admit both actual written kinds and its third field retains the reference identity.
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
interface SlotRecord { first: number | string; second: number | string; third: WritePoint; count: number; array: boolean; }
class WriteCarrier {
  values: SlotRecord;
  constructor(values: SlotRecord) { this.values = values; }
  replace(row: WriteRow): void { this.values.first = row.text; this.values.second = row.extra; this.values.third = row.next; }
}
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: row.point, count: 3, array: true };
  const holder = new WriteCarrier(value); same(holder.values, value);
  holder.replace(row);
  same(value.array, true); same(value.count, 3);
  same(value.first, row.text); same(value.second, row.extra); same(value.third, row.next);
  same(holder.values.array, true); same(holder.values.count, 3);
  same(holder.values.first, row.text); same(holder.values.second, row.extra); same(holder.values.third, row.next);
}
