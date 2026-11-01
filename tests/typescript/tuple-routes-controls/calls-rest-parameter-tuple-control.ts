/*---
description: "Control for calls-rest-parameter-tuple; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = { first: number; second: string; third: TuplePoint; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function receive(row: TupleRow, value: TupleValue): TupleRow {
  same(value.count, 3); same(value.array, true);
  same(value.first, row.num); same(value.second, row.text); same(value.third, row.ref);
  return { num: value.first, text: value.second, ref: value.third };
}
for (const row of rows) {
  const result = receive(row, { first: row.num, second: row.text, third: row.ref, count: 3, array: true });
  same(result.num, row.num); same(result.text, row.text); same(result.ref, row.ref);
}
