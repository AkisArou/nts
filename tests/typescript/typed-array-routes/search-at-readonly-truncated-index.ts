/*---
description: "At truncates finite indexes toward zero, counts from the end, and returns undefined beyond either boundary."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined]
---*/

// At truncates finite indexes toward zero, counts from the end, and returns undefined beyond either boundary. Route: readonly input and index-answer rows for Int16 arrays. Node prints search-at-readonly-truncated-index:ok.
type Samples = Int16Array;
const indexes: readonly number[] = [-5, -4, -1, -0.9, 0, 1.7, -1.7, 3.9, 4, Infinity, -Infinity, NaN];
const rows: readonly [readonly number[], readonly (number | undefined)[]][] = [
  [[10, 20, 30, 40], [undefined, 10, 40, 10, 10, 20, 40, 40, undefined, undefined, undefined, 10]],
  [[], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]]
];
for (const [input, expected] of rows) {
  const data: Samples = new Int16Array(input);
  for (let i = 0; i < indexes.length; i++) assert.sameValue(data.at(indexes[i]), expected[i]);
}
console.log("search-at-readonly-truncated-index:ok");
