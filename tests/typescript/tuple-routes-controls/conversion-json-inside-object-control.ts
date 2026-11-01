/*---
description: "Control for conversion-json-inside-object; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-json-stringify]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [{ num: -0, text: "", json: '{"payload":[0,"",{"id":7}],"label":"box"}' }, { num: NaN, text: "tail", json: '{"payload":[null,"tail",{"id":7}],"label":"box"}' }, { num: 2.5, text: "x", json: '{"payload":[2.5,"x",{"id":7}],"label":"box"}' }];
type Inner = { first: number; second: string; third: TuplePoint; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const holder: { payload: Inner; label: string } = { payload: { first: row.num, second: row.text, third: marker, count: 3, array: true }, label: "box" }; const value = holder.payload;
  same(value.count, 3); same(value.array, true); same(value.first, row.num); same(value.second, row.text); same(value.third, marker);
  const encoded = '{"payload":[' + JSON.stringify(value.first) + ',' + JSON.stringify(value.second) + ',' + JSON.stringify(value.third) + '],"label":' + JSON.stringify(holder.label) + '}'; same(encoded, row.json);
}
