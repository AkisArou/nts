/*---
description: "A typed tuple inside object retains its nested shape and exact JSON."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-json-stringify]
---*/
// [number,string,TuplePoint] held in a declared object field reaches JSON.stringify; node keeps every nested slot, original reference and exact bracket structure.
type TuplePoint = { id: number };
type JsonRow = { num: number; text: string; json: string };
const marker: TuplePoint = { id: 7 };
const rows: JsonRow[] = [{ num: -0, text: "", json: '{"payload":[0,"",{"id":7}],"label":"box"}' }, { num: NaN, text: "tail", json: '{"payload":[null,"tail",{"id":7}],"label":"box"}' }, { num: 2.5, text: "x", json: '{"payload":[2.5,"x",{"id":7}],"label":"box"}' }];
type Inner = [number, string, TuplePoint];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const holder: { payload: Inner; label: string } = { payload: [row.num, row.text, marker], label: "box" }; const value = holder.payload;
  same(value.length, 3); same(Array.isArray(value), true); same(value[0], row.num); same(value[1], row.text); same(value[2], marker);
  const encoded = JSON.stringify(holder); same(encoded, row.json);
}
