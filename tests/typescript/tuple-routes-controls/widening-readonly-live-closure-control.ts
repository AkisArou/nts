/*---
description: "Control for widening-readonly-live-closure; use named slots and explicit logical array metadata."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-readonly, ts-closures, ts-function-types, ts-arrow-functions]
---*/
// Replace the tuple with named fields, count and array metadata; keep the same writes and exact logical observations. A readonly interface reads the same mutable named-slot record through the retained closure; explicit field writes preserve aliasing and call timing.
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
interface SlotRecord { first: number; second: string; third: WritePoint; count: number; array: boolean; }
interface ReadSlots { readonly first: number; readonly second: string; readonly third: WritePoint; readonly count: number; readonly array: boolean; }
function later(value: ReadSlots, row: WriteRow): () => void {
  return () => { same(value.array, true); same(value.count, 3); same(value.first, row.extra); same(value.second, row.text + "!"); same(value.third, row.next); };
}
for (const row of rows) {
  const value: SlotRecord = { first: row.num, second: row.text, third: row.point, count: 3, array: true };
  const view: ReadSlots = value;
  const read = later(view, row); same(view, value);
  value.first = row.extra; value.second = row.text + "!"; value.third = row.next; read();
  same(view.array, true); same(view.count, 3);
  same(view.first, row.extra); same(view.second, row.text + "!"); same(view.third, row.next);
}
