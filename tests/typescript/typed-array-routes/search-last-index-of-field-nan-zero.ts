/*---
description: "LastIndexOf skips NaN, treats zero signs alike, and returns the final matching position."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-this]
---*/

// LastIndexOf skips NaN, treats zero signs alike, and returns the final matching position. Route: a public Float64 array field. Node prints search-last-index-of-field-nan-zero:ok.
type Samples = Float64Array;
class SearchStore { data: Samples; constructor(data: Samples) { this.data = data; } }
const needles: readonly number[] = [NaN, 0, -0, 7, 11];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], [-1, -1, -1, -1, -1]],
  [[NaN, -0, 7, 0, NaN, 7], [-1, 3, 3, 5, -1]],
  [[-0, 11, NaN, 0, 11], [-1, 3, 3, -1, 4]]
];
for (const [input, expected] of rows) {
  const store = new SearchStore(new Float64Array(input));
  for (let i = 0; i < needles.length; i++) assert.sameValue(store.data.lastIndexOf(needles[i]), expected[i]);
}
console.log("search-last-index-of-field-nan-zero:ok");
