/*---
description: "Control for conversion-json-inside-tuple; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-json-stringify]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [{ num: -0, text: "", json: '["",[0,{"id":7}],false]' }, { num: NaN, text: "tail", json: '["tail",[null,{"id":7}],false]' }, { num: 2.5, text: "x", json: '["x",[2.5,{"id":7}],false]' }];
type Inner = { first: number; second: TuplePoint; count: number; array: boolean };
type Outer = { first: string; second: Inner; third: boolean; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const inner: Inner = { first: row.num, second: marker, count: 2, array: true }; const value: Outer = { first: row.text, second: inner, third: false, count: 3, array: true };
  same(value.count, 3); same(value.array, true); same(value.first, row.text); same(value.second, inner); same(value.third, false);
  same(value.second.count, 2); same(value.second.array, true); same(value.second.first, row.num); same(value.second.second, marker);
  const encoded = '[' + JSON.stringify(value.first) + ',[' + JSON.stringify(value.second.first) + ',' + JSON.stringify(value.second.second) + '],' + JSON.stringify(value.third) + ']'; same(encoded, row.json);
}
