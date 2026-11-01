/*---
description: "Control for conversion-map-callback-slots; read named slot fields with explicit count and array metadata."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-null-undefined]
---*/
// Use named fields and explicit count/array facts for each logical tuple; retain the input values, ordered computation and observations.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = { first: number; second: string; third: TuplePoint; fourth: undefined; count: number; array: boolean };
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function expected(row: TupleRow, i: number): unknown { return i === 0 ? row.num : i === 1 ? row.text : i === 2 ? row.ref : undefined; }
for (const row of rows) {
  const input: TupleValue = { first: row.num, second: row.text, third: row.ref, fourth: undefined, count: 4, array: true };
  same(input.count, 4); same(input.array, true); same(input.first, row.num); same(input.second, row.text); same(input.third, row.ref); same(input.fourth, undefined);
  const indexes: number[] = [];
  function visit(value: unknown, index: number): unknown { same(value, expected(row, index)); indexes.push(index); return value; }
  const seen: unknown[] = [visit(input.first, 0), visit(input.second, 1), visit(input.third, 2), visit(input.fourth, 3)];
  same(seen.length, 4); same(Array.isArray(seen), true);
  same(seen[0], row.num); same(seen[1], row.text); same(seen[2], row.ref); same(seen[3], undefined);
  same(Object.is(seen, input), false); assert.compareArray(indexes, [0, 1, 2, 3]);
}
