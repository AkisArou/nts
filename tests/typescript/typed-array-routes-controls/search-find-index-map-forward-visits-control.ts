/*---
description: "FindIndex returns the first matching index and visits exactly the prefix ending there, or the whole array on a miss. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-map-set, ts-strings, ts-narrowing, ts-errors, ts-arrow-functions, ts-closures]
---*/

function localInt32Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindIndex<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): number {
  for (let i = 0, length = items.length; i < length; i++) if (predicate(items[i], i, items)) return i; return -1;
}
// FindIndex returns the first matching index and visits exactly the prefix ending there, or the whole array on a miss. Route: Int32 arrays retrieved through guarded Map.get. Node prints search-find-index-map-forward-visits:ok.
type Samples = number[];
const stores: Map<string, Samples> = new Map([
  ["low", localInt32Array([9, -4, 8, -4])], ["high", localInt32Array([2147483647, 8, -2147483648, 8])], ["empty", localInt32Array([])]
]);
const rows: readonly [string, number, number, readonly number[]][] = [
  ["low", -4, 1, [0, 9, 1, -4]], ["low", 8, 2, [0, 9, 1, -4, 2, 8]],
  ["low", 0, -1, [0, 9, 1, -4, 2, 8, 3, -4]],
  ["high", -2147483648, 2, [0, 2147483647, 1, 8, 2, -2147483648]],
  ["high", 8, 1, [0, 2147483647, 1, 8]], ["empty", 8, -1, []]
];
for (const [key, needle, expected, expectedVisits] of rows) {
  const data = stores.get(key); if (data === undefined) throw new Error("missing sample");
  const visits: number[] = [], predicate = (value: number, index: number): boolean => { visits.push(index, value); return value === needle; };
  assert.sameValue(localFindIndex(data, predicate), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-index-map-forward-visits:ok");
