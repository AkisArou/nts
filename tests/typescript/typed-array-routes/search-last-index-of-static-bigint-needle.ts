/*---
description: "LastIndexOf retains high bigint bits and does not wrap negative or oversized needles into unsigned elements."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

// LastIndexOf retains high bigint bits and does not wrap negative or oversized needles into unsigned elements. Route: a replaced static BigUint64 array field. Node prints search-last-index-of-static-bigint-needle:ok.
type Samples = BigUint64Array;
class SearchSlot { static data: Samples = new BigUint64Array([]); }
const needles: readonly bigint[] = [18446744073709551615n, 9223372036854775808n, 0n, -1n, 18446744073709551616n, -9223372036854775808n];
const rows: readonly [readonly bigint[], readonly number[]][] = [
  [[18446744073709551615n, 0n, 9223372036854775808n, 18446744073709551615n], [3, 2, 1, -1, -1, -1]],
  [[9223372036854775808n, 18446744073709551615n, 0n, 18446744073709551615n, 9223372036854775808n], [3, 4, 2, -1, -1, -1]],
  [[], [-1, -1, -1, -1, -1, -1]]
];
for (const [input, expected] of rows) {
  SearchSlot.data = new BigUint64Array(input);
  for (let i = 0; i < needles.length; i++) assert.sameValue(SearchSlot.data.lastIndexOf(needles[i]), expected[i]);
}
console.log("search-last-index-of-static-bigint-needle:ok");
