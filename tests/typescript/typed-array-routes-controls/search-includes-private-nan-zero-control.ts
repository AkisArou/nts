/*---
description: "Includes finds NaN and either zero sign, while absent values and an empty array stay absent. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this]
---*/

function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localInteger(value: number): number { return value !== value ? 0 : value === Infinity || value === -Infinity ? value : value - value % 1; }
function localIncludes<T extends number | bigint>(items: readonly T[], needle: T, fromIndex = 0): boolean {
  let first = localInteger(fromIndex); if (first < 0) first += items.length; if (first < 0) first = 0;
  for (let i = first; i < items.length; i++) if (items[i] === needle || items[i] !== items[i] && needle !== needle) return true; return false;
}
// Includes finds NaN and either zero sign, while absent values and an empty array stay absent. Route: a private Float64 array field. Node prints search-includes-private-nan-zero:ok.
type Samples = number[];
class SearchStore {
  #data: Samples; constructor(data: Samples) { this.#data = data; }
  contains(needle: number): boolean { return localIncludes(this.#data, needle); }
}
const needles: readonly number[] = [NaN, 0, -0, 3, 5, 99];
const rows: readonly [readonly number[], readonly boolean[]][] = [
  [[], [false, false, false, false, false, false]],
  [[NaN, -0, 3, NaN], [true, true, true, true, false, false]],
  [[5, 0, -0, NaN], [true, true, true, false, true, false]]
];
for (const [input, expected] of rows) {
  const store = new SearchStore(localFloat64Array(input));
  for (let i = 0; i < needles.length; i++) assert.sameValue(store.contains(needles[i]), expected[i]);
}
console.log("search-includes-private-nan-zero:ok");
