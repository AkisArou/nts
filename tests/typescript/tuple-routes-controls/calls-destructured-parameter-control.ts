/*---
description: "Control for calls-destructured-parameter; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = { first: TuplePoint; second: number; third: string; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function unpack(value: TupleValue, row: TupleRow): TupleRow {
  const ref = value.first, num = value.second, text = value.third;
  same(ref, row.ref); same(num, row.num); same(text, row.text);
  return { num, text, ref };
}
for (const row of rows) {
  const input: TupleValue = { first: row.ref, second: row.num, third: row.text, count: 3, array: true };
  same(input.count, 3); same(input.array, true);
  same(input.first, row.ref); same(input.second, row.num); same(input.third, row.text);
  const result = unpack(input, row);
  same(result.num, row.num); same(result.text, row.text); same(result.ref, row.ref);
}
