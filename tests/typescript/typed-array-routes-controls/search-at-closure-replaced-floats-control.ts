/*---
description: "At reads the current captured float array and preserves NaN, infinity and the sign of zero. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-closures, ts-arrow-functions]
---*/

function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localAt<T extends number | bigint>(items: readonly T[], index: number): T | undefined {
  let position = localInteger(index); if (position < 0) position += items.length;
  for (let i = 0; i < items.length; i++) if (i === position) return items[i]; return undefined;
}
// At reads the current captured float array and preserves NaN, infinity and the sign of zero. Route: a typed reader closure over a replaced Float64 array. Node prints search-at-closure-replaced-floats:ok.
type Samples = number[];
let data: Samples = localFloat64Array([]);
const read = (index: number): number | undefined => localAt(data, index);
const indexes: readonly number[] = [-1, -2, 0, 1, 2, 3, 0.9, -0.9];
const rows: readonly [readonly number[], readonly (number | undefined)[]][] = [
  [[-0, NaN, Infinity], [Infinity, NaN, -0, NaN, Infinity, undefined, -0, -0]],
  [[-Infinity, -0], [-0, -Infinity, -Infinity, -0, undefined, undefined, -Infinity, -Infinity]],
  [[], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]]
];
for (const [input, expected] of rows) {
  data = localFloat64Array(input);
  for (let i = 0; i < indexes.length; i++) assert.sameValue(read(indexes[i]), expected[i]);
}
console.log("search-at-closure-replaced-floats:ok");
