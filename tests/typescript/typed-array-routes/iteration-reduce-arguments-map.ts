/*---
description: "Reduce supplies the current accumulator, element, index and original receiver in order."
features: [ts-typed-array-routes, ts-typed-array-route-iteration, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-readonly, ts-numbers, ts-map-set, ts-tuples, ts-arrow-functions]
---*/

// Reduce supplies the current accumulator, element, index and original receiver in order. Route: numeric arrays retrieved through guarded Map.get.
// Node prints iteration-reduce-arguments-map:ok.
type Values = Int32Array;
const arrays: Map<string, Values> = new Map([["a", new Int32Array([2, -3, 4])], ["b", new Int32Array([-2, 3, -4])]]);
const rows: readonly [string, number, readonly (number | boolean)[]][] = [["a", 13, [10, 2, 0, true, 12, -3, 1, true, 9, 4, 2, true]], ["b", 7, [10, -2, 0, true, 8, 3, 1, true, 11, -4, 2, true]]];
for (const [name, expected, expectedLog] of rows) {
  const data = arrays.get(name); if (data === undefined) throw new Error("missing route"); const log: (number | boolean)[] = [];
  const result = data.reduce((sum, value, index, self) => { log.push(sum, value, index, self === data); return sum + value; }, 10);
  assert.sameValue(result, expected); assert.compareArray(log, expectedLog);
}
console.log("iteration-reduce-arguments-map:ok");
