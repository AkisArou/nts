/*---
description: "IndexOf preserves wide bigint needles and rejects values that would only match after signed wrapping."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-bigint, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

// IndexOf preserves wide bigint needles and rejects values that would only match after signed wrapping. Route: a private BigInt64 array field. Node prints search-index-of-private-bigint-needle:ok.
type Samples = BigInt64Array;
class SearchStore {
  #data: Samples = new BigInt64Array([-1n, -9223372036854775808n, 17n, -1n]);
  locate(needle: bigint, start: number): number { return this.#data.indexOf(needle, start); }
}
const store = new SearchStore();
const rows: readonly [bigint, number, number][] = [
  [-1n, 0, 0], [-1n, 1, 3], [-1n, -1, 3], [-9223372036854775808n, 0, 1],
  [18446744073709551615n, 0, -1], [9223372036854775808n, 0, -1], [17n, -2, 2],
  [18446744073709551633n, 0, -1], [-1n, 4, -1], [1n, 0, -1]
];
for (const [needle, start, expected] of rows) assert.sameValue(store.locate(needle, start), expected);
console.log("search-index-of-private-bigint-needle:ok");
