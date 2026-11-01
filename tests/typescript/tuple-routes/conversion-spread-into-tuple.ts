/*---
description: "A tuple spread between new leading and trailing slots keeps every declared position."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-spread]
---*/
// [number,string] is spread between a reference and a boolean in a [TuplePoint,number,string,boolean] result; node retains all four slots and creates a new array.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type Source = [number, string];
type Target = [TuplePoint, number, string, boolean];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const input: Source = [row.num, row.text];
  same(input.length, 2); same(Array.isArray(input), true); same(input[0], row.num); same(input[1], row.text);
  const result: Target = [row.ref, ...input, false];
  same(result.length, 4); same(Array.isArray(result), true); same(result[0], row.ref); same(result[1], row.num); same(result[2], row.text); same(result[3], false);
  same(Object.is(result, input), false);
}
