/*---
description: "IndexOf never finds NaN, treats zero signs alike, and returns the first matching position."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-static]
---*/

// IndexOf never finds NaN, treats zero signs alike, and returns the first matching position. Route: a replaced static Float64 array field. Node prints search-index-of-static-nan-zero:ok.
type Samples = Float64Array;
class SearchSlot { static data: Samples = new Float64Array([]); }
const needles: readonly number[] = [NaN, 0, -0, 7, 11];
const rows: readonly [readonly number[], readonly number[]][] = [
  [[], [-1, -1, -1, -1, -1]],
  [[NaN, -0, 7, 0, NaN, 7], [-1, 1, 1, 2, -1]],
  [[-0, 11, NaN, 0, 11], [-1, 0, 0, -1, 1]]
];
for (const [input, expected] of rows) {
  SearchSlot.data = new Float64Array(input);
  for (let i = 0; i < needles.length; i++) assert.sameValue(SearchSlot.data.indexOf(needles[i]), expected[i]);
}
console.log("search-index-of-static-nan-zero:ok");
