/*---
description: "A tuple argument list supplies all heterogeneous parameters in order."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-spread]
---*/
// [number,string,TuplePoint] is spread into a typed call; node supplies all three original payloads and the final row argument in order.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [number, string, TuplePoint];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function receive(num: number, text: string, ref: TuplePoint, row: TupleRow): TupleRow {
  same(num, row.num); same(text, row.text); same(ref, row.ref); same(arguments.length, 4);
  return { num, text, ref };
}
for (const row of rows) {
  const input: TupleValue = [row.num, row.text, row.ref];
  same(input.length, 3); same(Array.isArray(input), true);
  same(input[0], row.num); same(input[1], row.text); same(input[2], row.ref);
  const result = receive(...input, row);
  same(result.num, row.num); same(result.text, row.text); same(result.ref, row.ref);
}
