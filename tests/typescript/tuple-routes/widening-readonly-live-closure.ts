/*---
description: "A captured readonly array view reads current tuple slots after a mutable alias replaces them."
features: [ts-tuple-routes, ts-tuple-route-widening, ts-arrays, ts-objects, ts-interfaces, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-readonly, ts-closures, ts-function-types, ts-arrow-functions, ts-tuples, ts-unions]
---*/
// A readonly [number,string,WritePoint] view becomes a captured readonly array parameter; later writes through the mutable tuple are visible when the reader runs.
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
function later(value: readonly (number | string | WritePoint)[], row: WriteRow): () => void {
  return () => { same(Array.isArray(value), true); same(value.length, 3); same(value[0], row.extra); same(value[1], row.text + "!"); same(value[2], row.next); };
}
for (const row of rows) {
  const value: [number, string, WritePoint] = [row.num, row.text, row.point];
  const view: readonly [number, string, WritePoint] = value;
  const read = later(view, row); same(view, value);
  value[0] = row.extra; value[1] = row.text + "!"; value[2] = row.next; read();
  same(Array.isArray(view), true); same(view.length, 3);
  same(view[0], row.extra); same(view[1], row.text + "!"); same(view[2], row.next);
}
