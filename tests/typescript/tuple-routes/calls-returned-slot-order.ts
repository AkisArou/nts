/*---
description: "A tuple result keeps a reference, text and number in its declared order."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples]
---*/
// A [TuplePoint,string,number] return reorders typed scalar arguments; node retains reference identity, negative zero, NaN and every position.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [TuplePoint, string, number];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function makeResult(num: number, text: string, ref: TuplePoint): TupleValue { return [ref, text, num]; }
for (const row of rows) {
  const result: TupleValue = makeResult(row.num, row.text, row.ref);
  same(result.length, 3); same(Array.isArray(result), true);
  same(result[0], row.ref); same(result[1], row.text); same(result[2], row.num);
}
