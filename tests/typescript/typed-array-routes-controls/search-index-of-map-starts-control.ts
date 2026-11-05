/*---
description: "IndexOf returns the first match at or after its normalized start in the selected stored array. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-map-set, ts-strings, ts-narrowing, ts-errors]
---*/

function localInt32Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIndexOf<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): number {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle) return i; return -1;
}
// IndexOf returns the first match at or after its normalized start in the selected stored array. Route: Int32 arrays retrieved through guarded Map.get. Node prints search-index-of-map-starts:ok.
type Samples = number[];
const stores: Map<string, Samples> = new Map([["repeat", localInt32Array([-7, 4, -7, 4])], ["one", localInt32Array([4])]]);
const rows: readonly [string, number, number, number][] = [
  ["repeat", 4, 2, 3], ["repeat", -7, -2, 2], ["repeat", 4, -2, 3], ["repeat", -7, -1, -1],
  ["repeat", -7, -10, 0], ["repeat", -7, 4, -1], ["repeat", 4, Infinity, -1], ["repeat", 4, -Infinity, 1],
  ["repeat", 4, 1.9, 1], ["repeat", -7, -1.9, -1], ["repeat", -7, NaN, 0],
  ["one", 4, 1, -1], ["one", 4, -1, 0], ["one", 4, 0.9, 0]
];
for (const [key, needle, start, expected] of rows) {
  const data = stores.get(key); if (data === undefined) throw new Error("missing sample");
  assert.sameValue(localIndexOf(data, needle, start), expected);
}
console.log("search-index-of-map-starts:ok");
