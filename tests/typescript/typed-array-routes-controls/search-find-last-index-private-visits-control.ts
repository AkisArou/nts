/*---
description: "FindLastIndex stops at the final match and visits each preceding candidate only when needed. (control)"
features: [ts-typed-array-routes, ts-typed-array-route-search, ts-arrays, ts-functions, ts-iteration, ts-type-aliases, ts-numbers, ts-readonly, ts-tuples, ts-destructuring, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-arrow-functions, ts-closures]
---*/

function localUint8Array(input: readonly number[]): number[] { const result: number[] = []; for (let i = 0; i < input.length; i++) result[i] = input[i]; return result; }
function localFindLastIndex<T extends number | bigint>(items: T[], predicate: (value: T, index: number, owner: T[]) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i], i, items)) return i; return -1;
}
// FindLastIndex stops at the final match and visits each preceding candidate only when needed. Route: a private Uint8 array field with a typed predicate method. Node prints search-find-last-index-private-visits:ok.
type Samples = number[];
class SearchStore {
  #data: Samples; constructor(data: Samples) { this.#data = data; }
  locate(predicate: (value: number, index: number) => boolean): number { return localFindLastIndex(this.#data, predicate); }
}
const seed: readonly number[] = [5, 2, 9, 2];
const rows: readonly [readonly number[], number, number, readonly number[]][] = [
  [seed, 2, 3, [3, 2]], [seed, 9, 2, [3, 2, 2, 9]],
  [seed, 5, 0, [3, 2, 2, 9, 1, 2, 0, 5]], [seed, 0, -1, [3, 2, 2, 9, 1, 2, 0, 5]], [[], 2, -1, []]
];
for (const [input, needle, expected, expectedVisits] of rows) {
  const store = new SearchStore(localUint8Array(input)), visits: number[] = [];
  const predicate = (value: number, index: number): boolean => { visits.push(index, value); return value === needle; };
  assert.sameValue(store.locate(predicate), expected); assert.compareArray(visits, expectedVisits);
}
console.log("search-find-last-index-private-visits:ok");
