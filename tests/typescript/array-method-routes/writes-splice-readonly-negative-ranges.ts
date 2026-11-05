/*---
description: "Splice counts negative starts from the end and truncates or clamps range arguments through readonly tuples of start and count plans."
features: [ts-array-method-routes, ts-array-method-route-writes, ts-arrays, ts-functions, ts-iteration, ts-readonly, ts-tuples, ts-numbers]
---*/

// Splice counts negative starts from the end and truncates or clamps range arguments; route: readonly tuples of start and count plans.
// Node prints writes-splice-readonly-negative-ranges:ok.
const rows: readonly [number, number, readonly number[], readonly number[]][] = [
  [-2, 1, [4], [1, 2, 3, 5]], [-8, 2, [1, 2], [3, 4, 5]], [-1.9, 1, [5], [1, 2, 3, 4]],
  [1.9, 2.8, [2, 3], [1, 4, 5]], [NaN, 1, [1], [2, 3, 4, 5]],
  [Infinity, 2, [], [1, 2, 3, 4, 5]], [-Infinity, 1, [1], [2, 3, 4, 5]]
];
for (const [start, count, removed, remaining] of rows) {
  const input: number[] = [1, 2, 3, 4, 5];
  const result = input.splice(start, count);
  assert.compareArray(result, removed);
  assert.compareArray(input, remaining);
  assert.sameValue(result === input, false);
}
console.log("writes-splice-readonly-negative-ranges:ok");
