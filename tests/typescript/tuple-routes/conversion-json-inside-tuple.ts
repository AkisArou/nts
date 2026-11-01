/*---
description: "A typed tuple inside tuple retains its nested shape and exact JSON."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-json-stringify]
---*/
// A [number,TuplePoint] inner tuple held in a [string,Inner,boolean] outer tuple reaches JSON.stringify; node keeps every nested slot, original reference and exact bracket structure.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [{ num: -0, text: "", json: '["",[0,{"id":7}],false]' }, { num: NaN, text: "tail", json: '["tail",[null,{"id":7}],false]' }, { num: 2.5, text: "x", json: '["x",[2.5,{"id":7}],false]' }];
type Inner = [number, TuplePoint];
type Outer = [string, Inner, boolean];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const inner: Inner = [row.num, marker]; const value: Outer = [row.text, inner, false];
  same(value.length, 3); same(Array.isArray(value), true); same(value[0], row.text); same(value[1], inner); same(value[2], false);
  same(value[1].length, 2); same(Array.isArray(value[1]), true); same(value[1][0], row.num); same(value[1][1], marker);
  const encoded = JSON.stringify(value); same(encoded, row.json);
}
