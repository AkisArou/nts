/*---
description: "A tuple-typed rest parameter receives a fresh array with exact heterogeneous slots."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-rest-parameters]
---*/
// Typed scalar inputs become a [number,string,TuplePoint] rest tuple inside the callee; node exposes length three and the original payloads.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [number, string, TuplePoint];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function receive(row: TupleRow, ...value: TupleValue): TupleRow {
  same(value.length, 3); same(Array.isArray(value), true);
  same(value[0], row.num); same(value[1], row.text); same(value[2], row.ref);
  return { num: value[0], text: value[1], ref: value[2] };
}
for (const row of rows) {
  const result = receive(row, row.num, row.text, row.ref);
  same(result.num, row.num); same(result.text, row.text); same(result.ref, row.ref);
}
