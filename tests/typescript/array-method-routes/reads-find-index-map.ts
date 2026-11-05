/*---
description: "findIndex returns the first matching position or minus one and records only the visited prefix."
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-map-set, ts-readonly, ts-tuples, ts-strings, ts-null-undefined, ts-narrowing, ts-destructuring, ts-arrow-functions]
---*/

// findIndex returns the first matching position or minus one and records only the visited prefix. Route: guarded Map.get reads of readonly number arrays. Node prints reads-find-index-map:ok.
const groups: Map<string, readonly number[]> = new Map<string, readonly number[]>([["main", [5, 12, 8, 130, 44]], ["empty", []], ["one", [12]]]);
const rows: readonly [string, number, number, readonly number[]][] = [
  ["main", 10, 1, [5, 12]], ["main", 200, -1, [5, 12, 8, 130, 44]], ["main", 0, 0, [5]],
  ["empty", 10, -1, []], ["one", 10, 0, [12]], ["one", 20, -1, [12]]
];
for (const [key, limit, expected, visits] of rows) {
  const items = groups.get(key); assert.sameValue(items === undefined, false);
  if (items !== undefined) {
    const seen: number[] = [];
    const found = items.findIndex(value => { seen[seen.length] = value; return value > limit; });
    assert.sameValue(found, expected); assert.compareArray(seen, visits);
  }
}
console.log("reads-find-index-map:ok");
