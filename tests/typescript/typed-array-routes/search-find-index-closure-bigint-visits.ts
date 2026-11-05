/*---
description: "FindIndex searches the current captured bigint array and stops at the first exact matching value."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-arrow-functions, ts-closures]
---*/

// FindIndex searches the current captured bigint array and stops at the first exact matching value. Route: a typed closure over replaced array and needle bindings. Node prints search-find-index-closure-bigint-visits:ok.
type Samples = BigInt64Array;
let data: Samples = new BigInt64Array([]), needle = 0n;
const visits: (number | bigint)[] = [];
const predicate = (value: bigint, index: number): boolean => { visits.push(index, value); return value === needle; };
const locate = (): number => data.findIndex(predicate);
const rows: readonly [readonly bigint[], bigint, number, readonly (number | bigint)[]][] = [
  [[-1n, 9007199254740993n, -1n], -1n, 0, [0, -1n]],
  [[-1n, 9007199254740993n, -1n], 9007199254740993n, 1, [0, -1n, 1, 9007199254740993n]],
  [[-9223372036854775808n, 2n], 2n, 1, [0, -9223372036854775808n, 1, 2n]],
  [[1n, -1n], 2n, -1, [0, 1n, 1, -1n]], [[], 0n, -1, []]
];
for (const [input, wanted, expected, expectedVisits] of rows) {
  data = new BigInt64Array(input); needle = wanted; visits.length = 0;
  assert.sameValue(locate(), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-index-closure-bigint-visits:ok");
