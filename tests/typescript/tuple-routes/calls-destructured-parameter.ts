/*---
description: "A destructured tuple parameter preserves every binding position and payload."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-calls, ts-tuples, ts-destructuring]
---*/
// [TuplePoint,number,string] reaches destructured typed parameters; node binds the original reference, signed number and text without conversion.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [TuplePoint, number, string];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function unpack([ref, num, text]: TupleValue, row: TupleRow): TupleRow {
  same(ref, row.ref); same(num, row.num); same(text, row.text);
  return { num, text, ref };
}
for (const row of rows) {
  const input: TupleValue = [row.ref, row.num, row.text];
  same(input.length, 3); same(Array.isArray(input), true);
  same(input[0], row.ref); same(input[1], row.num); same(input[2], row.text);
  const result = unpack(input, row);
  same(result.num, row.num); same(result.text, row.text); same(result.ref, row.ref);
}
