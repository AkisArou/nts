/*---
description: "Concatenating differently ordered tuples preserves all six output positions."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples]
---*/
// [number,string,TuplePoint] concatenates [TuplePoint,string,number]; node returns a fresh six-element array in exact source order.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [number, string, TuplePoint];
type Suffix = [TuplePoint, string, number];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const input: TupleValue = [row.num, row.text, row.ref], tail: Suffix = [row.ref, row.text + "!", row.num];
  same(input.length, 3); same(Array.isArray(input), true);
  same(input[0], row.num); same(input[1], row.text); same(input[2], row.ref);
  same(tail.length, 3); same(Array.isArray(tail), true); same(tail[0], row.ref); same(tail[1], row.text + "!"); same(tail[2], row.num);
  const result: unknown[] = input.concat(tail);
  same(result.length, 6); same(Array.isArray(result), true); same(Object.is(result, input), false); same(Object.is(result, tail), false);
  same(result[0], row.num); same(result[1], row.text); same(result[2], row.ref);
  same(result[3], row.ref); same(result[4], row.text + "!"); same(result[5], row.num);
}
