/*---
description: "A typed tuple parameter returned by identity keeps every slot and its array shape."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples]
---*/
// [number,string,TuplePoint] crosses a typed parameter and aliased return; node retains the same array and all three exact slots.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [number, string, TuplePoint];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function echo(value: TupleValue, row: TupleRow): TupleValue {
  same(value.length, 3); same(Array.isArray(value), true);
  same(value[0], row.num); same(value[1], row.text); same(value[2], row.ref);
  return value;
}
for (const row of rows) {
  const input: TupleValue = [row.num, row.text, row.ref];
  const result: TupleValue = echo(input, row); same(result, input);
  same(result.length, 3); same(Array.isArray(result), true);
  same(result[0], row.num); same(result[1], row.text); same(result[2], row.ref);
}
