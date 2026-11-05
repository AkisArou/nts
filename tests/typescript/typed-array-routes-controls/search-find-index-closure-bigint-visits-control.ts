/*---
description: "FindIndex searches the current captured bigint array and stops at the first exact matching value. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-arrow-functions, ts-closures]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindIndex<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): number {
  for (let i = 0, length = items.length; i < length; i++) if (predicate(items[i], i, items)) return i; return -1;
}
// FindIndex searches the current captured bigint array and stops at the first exact matching value. Route: a typed closure over replaced array and needle bindings. Node prints search-find-index-closure-bigint-visits:ok.
type Samples = bigint[];
let data: Samples = localBigInt64Array([]), needle = 0n;
const visits: (number | bigint)[] = [];
const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; };
const locate = (): number => localFindIndex(data, predicate);
const rows: readonly [readonly bigint[], bigint, number, readonly (number | bigint)[]][] = [
  [[-1n, 9007199254740993n, -1n], -1n, 0, [0, -1n]],
  [[-1n, 9007199254740993n, -1n], 9007199254740993n, 1, [0, -1n, 1, 9007199254740993n]],
  [[-9223372036854775808n, 2n], 2n, 1, [0, -9223372036854775808n, 1, 2n]],
  [[1n, -1n], 2n, -1, [0, 1n, 1, -1n]], [[], 0n, -1, []]
];
for (const [input, wanted, expected, expectedVisits] of rows) {
  data = localBigInt64Array(input); needle = wanted; visits.length = 0;
  assert.sameValue(locate(), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-index-closure-bigint-visits:ok");
