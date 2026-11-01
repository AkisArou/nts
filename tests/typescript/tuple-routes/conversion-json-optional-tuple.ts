/*---
description: "JSON serialization of an optional typed tuple preserves slot order and exact absence text."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-tuple-optional, ts-null-undefined, ts-unions, ts-json-stringify]
---*/
// [number,string,TuplePoint,string?] reaches JSON.stringify; node prints -0 as 0, NaN and explicit undefined as null, and omits the absent optional tail.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; present: boolean; tail: string | undefined; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [
  { num: -0, text: "", present: false, tail: undefined, json: '[0,"",{"id":7}]' },
  { num: NaN, text: "tail", present: true, tail: undefined, json: '[null,"tail",{"id":7},null]' },
  { num: 2.5, text: "x", present: true, tail: "", json: '[2.5,"x",{"id":7},""]' },
  { num: -7, text: "end", present: true, tail: "done", json: '[-7,"end",{"id":7},"done"]' }
];
type JsonTuple = [number, string, TuplePoint, string?];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const value: JsonTuple = row.present ? [row.num, row.text, marker, row.tail] : [row.num, row.text, marker];
  same(value.length, row.present ? 4 : 3); same(Array.isArray(value), true); same(value[0], row.num); same(value[1], row.text); same(value[2], marker); same(value[3], row.tail);
  same(Object.hasOwn(value, 3), row.present);
  const encoded = JSON.stringify(value); same(encoded, row.json);
}
