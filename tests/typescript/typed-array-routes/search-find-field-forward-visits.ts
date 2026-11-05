/*---
description: "Find stops at the first matching value and records every forward visit, including complete no-match and empty searches."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-this, ts-arrow-functions, ts-closures]
---*/

// Find stops at the first matching value and records every forward visit, including complete no-match and empty searches. Route: a public Int16 array field. Node prints search-find-field-forward-visits:ok.
type Samples = Int16Array;
class SearchStore { data: Samples; constructor(data: Samples) { this.data = data; } }
const rows: readonly [readonly number[], number, number | undefined, readonly number[]][] = [
  [[5, -3, 7, -1], 0, -3, [0, 5, 1, -3]],
  [[5, -3, 7, -1], -4, undefined, [0, 5, 1, -3, 2, 7, 3, -1]],
  [[5, -3, 7, -1], 6, 5, [0, 5]],
  [[8, 2, -2, -5], 0, -2, [0, 8, 1, 2, 2, -2]], [[], 0, undefined, []]
];
for (const [input, limit, expected, expectedVisits] of rows) {
  const store = new SearchStore(new Int16Array(input)), visits: number[] = [];
  const predicate = (value: number, index: number): boolean => { visits.push(index, value); return value < limit; };
  assert.sameValue(store.data.find(predicate), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-field-forward-visits:ok");
