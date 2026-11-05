/*---
description: "every reads each rebound array and retains empty truth and exact stopping at a nonpositive value."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-readonly, ts-function-types, ts-arrow-functions, ts-closures, ts-tuples, ts-destructuring]
---*/

// every reads each rebound array and retains empty truth and exact stopping at a nonpositive value. Route: a typed closure over a mutable readonly-array binding. Node prints reads-every-captured-let:ok.
let items: readonly number[] = [];
const examine: (seen: number[]) => boolean = seen => items.every(value => { seen[seen.length] = value; return value > 0; });
const rows: readonly [readonly number[], boolean, readonly number[]][] = [
  [[], true, []], [[2, 4], true, [2, 4]], [[2, -1, 4], false, [2, -1]], [[0], false, [0]], [[3], true, [3]]
];
for (const [source, expected, visits] of rows) {
  items = source; const seen: number[] = [], result = examine(seen);
  assert.sameValue(result, expected); assert.compareArray(seen, visits);
}
console.log("reads-every-captured-let:ok");
