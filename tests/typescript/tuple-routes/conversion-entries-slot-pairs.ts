/*---
description: "Tuple entries retain every numeric index and corresponding heterogeneous value."
features: [ts-tuple-routes, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-typeof-operator, ts-type-aliases, ts-numbers, ts-strings, ts-unknown, ts-tuple-route-conversion, ts-tuples, ts-null-undefined]
---*/
// entries() reads [number,string,TuplePoint,undefined] and returns index/value tuples; node retains every pair shape, slot and full order.
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
  const seen: unknown[] = [], indexes: number[] = []; let index = 0;
  for (const entry of input.entries()) {
    same(entry.length, 2); same(Array.isArray(entry), true); same(entry[0], index);
    same(entry[1], expected(row, index)); indexes.push(entry[0]); seen.push(entry[1]); index++;
  }
  same(seen.length, 4); same(Array.isArray(seen), true);
  same(seen[0], row.num); same(seen[1], row.text); same(seen[2], row.ref); same(seen[3], undefined);
  same(index, 4); assert.compareArray(indexes, [0, 1, 2, 3]);
}
