/*---
description: "every reads each rebound array and retains empty truth and exact stopping at a nonpositive value. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-tuples, ts-destructuring]
---*/

function localEvery<T>(items: readonly T[], predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean {
  for (let index = 0; index < items.length; index++) if (!predicate(items[index], index, items)) return false;
  return true;
}
// every reads each rebound array and retains empty truth and exact stopping at a nonpositive value. Route: a typed closure over a mutable readonly-array binding. Node prints reads-every-captured-let:ok.
let items: readonly number[] = [];
const examine: (seen: number[]) => boolean = seen => localEvery(items, value => { seen[seen.length] = value; return value > 0; });
const rows: readonly [readonly number[], boolean, readonly number[]][] = [
  [[], true, []], [[2, 4], true, [2, 4]], [[2, -1, 4], false, [2, -1]], [[0], false, [0]], [[3], true, [3]]
];
for (const [source, expected, visits] of rows) {
  items = source; const seen: number[] = [], result = examine(seen);
  assert.sameValue(result, expected); assert.compareArray(seen, visits);
}
console.log("reads-every-captured-let:ok");
