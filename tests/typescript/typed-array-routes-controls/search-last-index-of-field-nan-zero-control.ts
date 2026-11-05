/*---
description: "LastIndexOf skips NaN, treats zero signs alike, and returns the final matching position. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-this]
---*/

function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localLastIndexOf<T extends number | bigint>(items: readonly T[], needle: T, ...starts: [number?]): number {
  let first = starts.length === 0 ? items.length - 1 : localInteger(starts[0] === undefined ? 0 : starts[0]);
  if (first >= items.length) first = items.length - 1; else if (first < 0) first += items.length;
  for (let i = first; i >= 0; i--) if (items[i] === needle) return i; return -1;
}
// LastIndexOf skips NaN, treats zero signs alike, and returns the final matching position. Route: a public Float64 array field. Node prints search-last-index-of-field-nan-zero:ok.
type Samples = number[];
class SearchStore { data: Samples; constructor(data: Samples) { this.data = data; } }
const needles: readonly number[] = [NaN, 0, -0, 7, 11];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], [-1, -1, -1, -1, -1]],
  [[NaN, -0, 7, 0, NaN, 7], [-1, 3, 3, 5, -1]],
  [[-0, 11, NaN, 0, 11], [-1, 3, 3, -1, 4]]
];
for (const [input, expected] of rows) {
  const store = new SearchStore(localFloat64Array(input));
  for (let i = 0; i < needles.length; i++) assert.sameValue(localLastIndexOf(store.data, needles[i]), expected[i]);
}
console.log("search-last-index-of-field-nan-zero:ok");
