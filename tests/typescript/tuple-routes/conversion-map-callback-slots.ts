/*---
description: "Mapping a typed tuple delivers each slot to the callback and builds an independent array."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-null-undefined]
---*/
// [number,string,TuplePoint,undefined] crosses map callback parameters; node calls in slot order and preserves exact values in a fresh result.
type TuplePoint = { id: number };
type TupleRow = { num: number; text: string; ref: TuplePoint };
const firstRef: TuplePoint = { id: 7 }, secondRef: TuplePoint = { id: 11 }, thirdRef: TuplePoint = { id: 13 };
const rows: TupleRow[] = [{ num: -0, text: "", ref: firstRef }, { num: NaN, text: "tail", ref: secondRef }, { num: 2.5, text: "0", ref: thirdRef }];
type TupleValue = [number, string, TuplePoint, undefined];
function same(actual: unknown, expected: unknown): void {
  assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected);
}
function expected(row: TupleRow, i: number): unknown { return i === 0 ? row.num : i === 1 ? row.text : i === 2 ? row.ref : undefined; }
for (const row of rows) {
  const input: TupleValue = [row.num, row.text, row.ref, undefined];
  same(input.length, 4); same(Array.isArray(input), true); same(input[0], row.num); same(input[1], row.text); same(input[2], row.ref); same(input[3], undefined);
  const indexes: number[] = [];
  function visit(value: unknown, index: number): unknown { same(value, expected(row, index)); indexes.push(index); return value; }
  const seen: unknown[] = input.map(visit);
  same(seen.length, 4); same(Array.isArray(seen), true);
  same(seen[0], row.num); same(seen[1], row.text); same(seen[2], row.ref); same(seen[3], undefined);
  same(Object.is(seen, input), false); assert.compareArray(indexes, [0, 1, 2, 3]);
}
