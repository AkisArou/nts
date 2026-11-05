/*---
description: "IndexOf preserves wide bigint needles and rejects values that would only match after signed wrapping. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

function localBigInt64Array(input: readonly bigint[]): bigint[] { const result: bigint[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIndexOf<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): number {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle) return i; return -1;
}
// IndexOf preserves wide bigint needles and rejects values that would only match after signed wrapping. Route: a private BigInt64 array field. Node prints search-index-of-private-bigint-needle:ok.
type Samples = bigint[];
class SearchStore {
  #data: Samples = localBigInt64Array([-1n, -9223372036854775808n, 17n, -1n]);
  locate(needle: bigint, start: number): number { return localIndexOf(this.#data, needle, start); }
}
const store = new SearchStore();
const rows: readonly [bigint, number, number][] = [
  [-1n, 0, 0], [-1n, 1, 3], [-1n, -1, 3], [-9223372036854775808n, 0, 1],
  [18446744073709551615n, 0, -1], [9223372036854775808n, 0, -1], [17n, -2, 2],
  [18446744073709551633n, 0, -1], [-1n, 4, -1], [1n, 0, -1]
];
for (const [needle, start, expected] of rows) assert.sameValue(store.locate(needle, start), expected);
console.log("search-index-of-private-bigint-needle:ok");
