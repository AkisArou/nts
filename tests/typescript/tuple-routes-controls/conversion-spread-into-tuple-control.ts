/*---
description: "Control for conversion-spread-into-tuple; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type Source = { first: number; second: string; count: number; array: boolean };
type Target = { first: TuplePoint; second: number; third: string; fourth: boolean; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
for (const row of rows) {
  const input: Source = { first: row.num, second: row.text, count: 2, array: true };
  same(input.count, 2); same(input.array, true); same(input.first, row.num); same(input.second, row.text);
  const result: Target = { first: row.ref, second: input.first, third: input.second, fourth: false, count: input.count + 2, array: input.array };
  same(result.count, 4); same(result.array, true); same(result.first, row.ref); same(result.second, row.num); same(result.third, row.text); same(result.fourth, false);
  same(Object.is(result, input), false);
}
