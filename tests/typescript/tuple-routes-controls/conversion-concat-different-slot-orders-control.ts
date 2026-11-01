/*---
description: "Control for conversion-concat-different-slot-orders; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = { first: number; second: string; third: TuplePoint; count: number; array: boolean };
type Suffix = { first: TuplePoint; second: string; third: number; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const input: TupleValue = { first: row.num, second: row.text, third: row.ref, count: 3, array: true }, tail: Suffix = { first: row.ref, second: row.text + "!", third: row.num, count: 3, array: true };
  same(input.count, 3); same(input.array, true);
  same(input.first, row.num); same(input.second, row.text); same(input.third, row.ref);
  same(tail.count, 3); same(tail.array, true); same(tail.first, row.ref); same(tail.second, row.text + "!"); same(tail.third, row.num);
  const result: unknown[] = [input.first, input.second, input.third, tail.first, tail.second, tail.third];
  same(result.length, 6); same(Array.isArray(result), true); same(Object.is(result, input), false); same(Object.is(result, tail), false);
  same(result[0], row.num); same(result[1], row.text); same(result[2], row.ref);
  same(result[3], row.ref); same(result[4], row.text + "!"); same(result[5], row.num);
}
