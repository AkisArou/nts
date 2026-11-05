/*---
description: "LastIndexOf distinguishes an omitted start from undefined and normalizes starts against the current captured array."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-closures, ts-arrow-functions]
---*/

// LastIndexOf distinguishes an omitted start from undefined and normalizes starts against the current captured array. Route: typed closures over a replaced Uint16 array. Node prints search-last-index-of-closure-starts:ok.
type Samples = Uint16Array;
let data: Samples = new Uint16Array([]);
const locate = (needle: number, start: number | undefined): number => data.lastIndexOf(needle, start);
const locateDefault = (needle: number): number => data.lastIndexOf(needle);
const starts: readonly (number | undefined)[] = [undefined, 0, -0, 1.9, -1.9, -2, 99, -10, Infinity, -Infinity, NaN];
const rows: readonly [readonly number[], number, number, readonly number[]][] = [
  [[1, 2, 1, 2], 1, 2, [0, 0, 0, 0, 2, 2, 2, -1, 2, -1, 0]],
  [[1, 2, 1, 2], 2, 3, [-1, -1, -1, 1, 3, 1, 3, -1, 3, -1, -1]],
  [[9, 9], 9, 1, [0, 0, 0, 1, 1, 0, 1, -1, 1, -1, 0]],
  [[], 9, -1, [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]]
];
for (const [input, needle, defaultExpected, expected] of rows) {
  data = new Uint16Array(input); assert.sameValue(locateDefault(needle), defaultExpected);
  const actual: number[] = []; for (let i = 0; i < starts.length; i++) actual[i] = locate(needle, starts[i]);
  assert.compareArray(actual, expected);
}
console.log("search-last-index-of-closure-starts:ok");
