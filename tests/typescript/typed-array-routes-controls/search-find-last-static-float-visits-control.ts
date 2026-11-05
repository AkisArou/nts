/*---
description: "FindLast searches backward and returns the exact NaN or signed-zero value selected by its predicate. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-static, ts-arrow-functions, ts-closures]
---*/

function localFloat64Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindLast<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) { const value = items[i]; if (predicate(value, i, items)) return value; } return undefined;
}
// FindLast searches backward and returns the exact NaN or signed-zero value selected by its predicate. Route: a replaced static Float64 array field. Node prints search-find-last-static-float-visits:ok.
type Samples = number[];
class SearchSlot { static data: Samples = localFloat64Array([]); }
const seed: readonly number[] = [NaN, -0, 3, 0, NaN, -0];
const rows: readonly [readonly number[], number, number | undefined, readonly number[]][] = [
  [seed, NaN, NaN, [5, -0, 4, NaN]], [seed, -0, -0, [5, -0]],
  [seed, 0, 0, [5, -0, 4, NaN, 3, 0]], [seed, 3, 3, [5, -0, 4, NaN, 3, 0, 2, 3]],
  [seed, 99, undefined, [5, -0, 4, NaN, 3, 0, 2, 3, 1, -0, 0, NaN]], [[], NaN, undefined, []]
];
for (const [input, needle, expected, expectedVisits] of rows) {
  SearchSlot.data = localFloat64Array(input); const visits: number[] = [];
  const predicate = (value: number, index: number): boolean => { visits.push(index, value); return Object.is(value, needle); };
  assert.sameValue(localFindLast(SearchSlot.data, predicate), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-last-static-float-visits:ok");
