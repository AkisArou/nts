/*---
description: "LastIndexOf retains high bigint bits and does not wrap negative or oversized needles into unsigned elements. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

function localBigUint64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localLastIndexOf<T extends number | bigint>(items: readonly T[], needle: T, ...starts: [number?]): number {
  let first = starts.length === 0 ? items.length - 1 : localInteger(starts[0] === undefined ? 0 : starts[0]);
  if (first >= items.length) first = items.length - 1; else if (first < 0) first += items.length;
  for (let i = first; i >= 0; i--) if (items[i] === needle) return i; return -1;
}
// LastIndexOf retains high bigint bits and does not wrap negative or oversized needles into unsigned elements. Route: a replaced static BigUint64 array field. Node prints search-last-index-of-static-bigint-needle:ok.
type Samples = bigint[];
class SearchSlot { static data: Samples = localBigUint64Array([]); }
const needles: readonly bigint[] = [18446744073709551615n, 9223372036854775808n, 0n, -1n, 18446744073709551616n, -9223372036854775808n];
const rows: readonly [readonly bigint[], readonly number[]][] = [
  [[18446744073709551615n, 0n, 9223372036854775808n, 18446744073709551615n], [3, 2, 1, -1, -1, -1]],
  [[9223372036854775808n, 18446744073709551615n, 0n, 18446744073709551615n, 9223372036854775808n], [3, 4, 2, -1, -1, -1]],
  [[], [-1, -1, -1, -1, -1, -1]]
];
for (const [input, expected] of rows) {
  SearchSlot.data = localBigUint64Array(input);
  for (let i = 0; i < needles.length; i++) assert.sameValue(localLastIndexOf(SearchSlot.data, needles[i]), expected[i]);
}
console.log("search-last-index-of-static-bigint-needle:ok");
