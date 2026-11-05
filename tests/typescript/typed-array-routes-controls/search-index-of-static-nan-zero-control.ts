/*---
description: "IndexOf never finds NaN, treats zero signs alike, and returns the first matching position. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIndexOf<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): number {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle) return i; return -1;
}
// IndexOf never finds NaN, treats zero signs alike, and returns the first matching position. Route: a replaced static Float64 array field. Node prints search-index-of-static-nan-zero:ok.
type Samples = number[];
class SearchSlot { static data: Samples = localFloat64Array([]); }
const needles: readonly number[] = [NaN, 0, -0, 7, 11];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], [-1, -1, -1, -1, -1]],
  [[NaN, -0, 7, 0, NaN, 7], [-1, 1, 1, 2, -1]],
  [[-0, 11, NaN, 0, 11], [-1, 0, 0, -1, 1]]
];
for (const [input, expected] of rows) {
  SearchSlot.data = localFloat64Array(input);
  for (let i = 0; i < needles.length; i++) assert.sameValue(localIndexOf(SearchSlot.data, needles[i]), expected[i]);
}
console.log("search-index-of-static-nan-zero:ok");
