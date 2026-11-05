/*---
description: "At reads the current captured float array and preserves NaN, infinity and the sign of zero."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-closures, ts-arrow-functions]
---*/

// At reads the current captured float array and preserves NaN, infinity and the sign of zero. Route: a typed reader closure over a replaced Float64 array. Node prints search-at-closure-replaced-floats:ok.
type Samples = Float64Array;
let data: Samples = new Float64Array([]);
const read = (index: number): number | undefined => data.at(index);
const indexes: readonly number[] = [-1, -2, 0, 1, 2, 3, 0.9, -0.9];
const rows: readonly [readonly number[], readonly (number | undefined)[]][] = [
  [[-0, NaN, Infinity], [Infinity, NaN, -0, NaN, Infinity, undefined, -0, -0]],
  [[-Infinity, -0], [-0, -Infinity, -Infinity, -0, undefined, undefined, -Infinity, -Infinity]],
  [[], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]]
];
for (const [input, expected] of rows) {
  data = new Float64Array(input);
  for (let i = 0; i < indexes.length; i++) assert.sameValue(read(indexes[i]), expected[i]);
}
console.log("search-at-closure-replaced-floats:ok");
