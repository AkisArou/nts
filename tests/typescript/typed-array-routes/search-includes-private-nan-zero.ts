/*---
description: "Includes finds NaN and either zero sign, while absent values and an empty array stay absent."
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

// Includes finds NaN and either zero sign, while absent values and an empty array stay absent. Route: a private Float64 array field. Node prints search-includes-private-nan-zero:ok.
type Samples = Float64Array;
class SearchStore {
  #data: Samples; constructor(data: Samples) { this.#data = data; }
  contains(needle: number): boolean { return this.#data.includes(needle); }
}
const needles: readonly number[] = [NaN, 0, -0, 3, 5, 99];
const rows: readonly [readonly number[], readonly boolean[]][] = [
  [[], [false, false, false, false, false, false]],
  [[NaN, -0, 3, NaN], [true, true, true, true, false, false]],
  [[5, 0, -0, NaN], [true, true, true, false, true, false]]
];
for (const [input, expected] of rows) {
  const store = new SearchStore(new Float64Array(input));
  for (let i = 0; i < needles.length; i++) assert.sameValue(store.contains(needles[i]), expected[i]);
}
console.log("search-includes-private-nan-zero:ok");
