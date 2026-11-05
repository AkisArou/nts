/*---
description: "LastIndexOf distinguishes an omitted start from undefined and normalizes starts against the current captured array. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-closures, ts-arrow-functions]
---*/

function localUint16Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localLastIndexOf<T extends number | bigint>(items: readonly T[], needle: T, ...starts: [number?]): number {
  let first = starts.length === 0 ? items.length - 1 : localInteger(starts[0] === undefined ? 0 : starts[0]);
  if (first >= items.length) first = items.length - 1; else if (first < 0) first += items.length;
  for (let i = first; i >= 0; i--) if (items[i] === needle) return i; return -1;
}
// LastIndexOf distinguishes an omitted start from undefined and normalizes starts against the current captured array. Route: typed closures over a replaced Uint16 array. Node prints search-last-index-of-closure-starts:ok.
type Samples = number[];
let data: Samples = localUint16Array([]);
const locate = (needle: number, start: number | undefined): number => localLastIndexOf(data, needle, start);
const locateDefault = (needle: number): number => localLastIndexOf(data, needle);
const starts: readonly (number | undefined)[] = [undefined, 0, -0, 1.9, -1.9, -2, 99, -10, Infinity, -Infinity, NaN];
const rows: readonly [readonly number[], number, number, readonly number[]][] = [
  [[1, 2, 1, 2], 1, 2, [0, 0, 0, 0, 2, 2, 2, -1, 2, -1, 0]],
  [[1, 2, 1, 2], 2, 3, [-1, -1, -1, 1, 3, 1, 3, -1, 3, -1, -1]],
  [[9, 9], 9, 1, [0, 0, 0, 1, 1, 0, 1, -1, 1, -1, 0]],
  [[], 9, -1, [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1]]
];
for (const [input, needle, defaultExpected, expected] of rows) {
  data = localUint16Array(input); assert.sameValue(locateDefault(needle), defaultExpected);
  const actual: number[] = []; for (let i = 0; i < starts.length; i++) actual[i] = locate(needle, starts[i]);
  assert.compareArray(actual, expected);
}
console.log("search-last-index-of-closure-starts:ok");
