/*---
description: "Control for conversion-json-optional-tuple; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-null-undefined, ts-unions, ts-json-stringify]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; present: boolean; tail: string | undefined; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [
  { num: -0, text: "", present: false, tail: undefined, json: '[0,"",{"id":7}]' },
  { num: NaN, text: "tail", present: true, tail: undefined, json: '[null,"tail",{"id":7},null]' },
  { num: 2.5, text: "x", present: true, tail: "", json: '[2.5,"x",{"id":7},""]' },
  { num: -7, text: "end", present: true, tail: "done", json: '[-7,"end",{"id":7},"done"]' }
];
type JsonTuple = { first: number; second: string; third: TuplePoint; fourth: string | undefined; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const value: JsonTuple = { first: row.num, second: row.text, third: marker, fourth: row.tail, count: row.present ? 4 : 3, array: true };
  same(value.count, row.present ? 4 : 3); same(value.array, true); same(value.first, row.num); same(value.second, row.text); same(value.third, marker); same(value.fourth, row.tail);
  same(value.count === 4, row.present);
  const encoded = '[' + JSON.stringify(value.first) + ',' + JSON.stringify(value.second) + ',' + JSON.stringify(value.third) + (value.count === 4 ? ',' + (value.fourth === undefined ? 'null' : JSON.stringify(value.fourth)) : '') + ']'; same(encoded, row.json);
}
