/*---
description: "At truncates finite indexes toward zero, counts from the end, and returns undefined beyond either boundary. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined]
---*/

function localInt16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localAt<T extends number | bigint>(items: readonly T[], index: number): T | undefined {
  let position = localInteger(index); if (position < 0) position += items.length;
  for (let i = 0; i < items.length; i++) if (i === position) return items[i]; return undefined;
}
// At truncates finite indexes toward zero, counts from the end, and returns undefined beyond either boundary. Route: readonly input and index-answer rows for Int16 arrays. Node prints search-at-readonly-truncated-index:ok.
type Samples = number[];
const indexes: readonly number[] = [-5, -4, -1, -0.9, 0, 1.7, -1.7, 3.9, 4, Infinity, -Infinity, NaN];
const rows: readonly [readonly number[], readonly (number | undefined)[]][] = [
  [[10, 20, 30, 40], [undefined, 10, 40, 10, 10, 20, 40, 40, undefined, undefined, undefined, 10]],
  [[], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]]
];
for (const [input, expected] of rows) {
  const data: Samples = localInt16Array(input);
  for (let i = 0; i < indexes.length; i++) assert.sameValue(localAt(data, indexes[i]), expected[i]);
}
console.log("search-at-readonly-truncated-index:ok");
