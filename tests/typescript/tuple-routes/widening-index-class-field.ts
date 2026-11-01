/*---
description: "A widened class field writes new slot kinds that the original tuple must observe."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-class, ts-class-fields, ts-unions, ts-unsound-covariant-array, ts-tuples]
---*/
// [number,string,WritePoint] aliases a union-array class field; indexed writes exchange number/string slots and replace the reference, and Node exposes every change through both views.
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
class WriteCarrier {
  values: (number | string | WritePoint)[];
  constructor(values: (number | string | WritePoint)[]) { this.values = values; }
  replace(row: WriteRow): void { this.values[0] = row.text; this.values[1] = row.extra; this.values[2] = row.next; }
}
for (const row of rows) {
  const value: [number, string, WritePoint] = [row.num, row.text, row.point];
  const holder = new WriteCarrier(value); same(holder.values, value);
  holder.replace(row);
  same(Array.isArray(value), true); same(value.length, 3);
  same(value[0], row.text); same(value[1], row.extra); same(value[2], row.next);
  same(Array.isArray(holder.values), true); same(holder.values.length, 3);
  same(holder.values[0], row.text); same(holder.values[1], row.extra); same(holder.values[2], row.next);
}
