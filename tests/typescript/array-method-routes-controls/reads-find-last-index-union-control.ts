/*---
description: "findLastIndex selects the last decisive position after discriminant-based predicate selection. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-type-aliases, ts-unions, ts-discriminated-unions, ts-narrowing, ts-readonly, ts-tuples, ts-objects, ts-strings, ts-destructuring, ts-function-types, ts-arrow-functions]
---*/

function localFindLastIndex<T>(items: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => unknown): number {
  for (let index = items.length - 1; index >= 0; index--) if (predicate(items[index], index, items)) return index;
  return -1;
}
// findLastIndex selects the last decisive position after discriminant-based predicate selection. Route: a discriminated union selecting the callback condition. Node prints reads-find-last-index-union:ok.
type MatchQuery = { kind: "over"; limit: number } | { kind: "below"; limit: number };
function choose(query: MatchQuery): (value: number) => boolean {
  if (query.kind === "over") return value => value > query.limit;
  return value => value < query.limit;
}
const items: readonly number[] = [5, 12, 8, 130, 44];
const rows: readonly [MatchQuery, number, readonly number[]][] = [
  [{ kind: "over", limit: 10 }, 4, [44]], [{ kind: "below", limit: 10 }, 2, [44, 130, 8]],
  [{ kind: "over", limit: 200 }, -1, [44, 130, 8, 12, 5]], [{ kind: "below", limit: 0 }, -1, [44, 130, 8, 12, 5]],
  [{ kind: "over", limit: 44 }, 3, [44, 130]]
];
for (const [query, expected, visits] of rows) {
  const predicate = choose(query), seen: number[] = [];
  const found = localFindLastIndex(items, value => { seen[seen.length] = value; return predicate(value); });
  assert.sameValue(found, expected); assert.compareArray(seen, visits);
}
console.log("reads-find-last-index-union:ok");
