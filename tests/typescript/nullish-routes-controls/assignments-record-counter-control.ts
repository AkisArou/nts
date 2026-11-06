/*---
description: "Nullish assignment initializes a computed Record counter before incrementing. Route: Record string index (control)"
features: [ts-nullish-routes, ts-nullish-route-assignments, ts-null-undefined]
---*/

// Nullish assignment initializes a computed Record counter before incrementing. Route: Record string index. Node prints assignments-record-counter:ok.
const counts: Record<string, number> = {};
function step(key: string): void {
  const saved = counts[key]; if (saved === null || saved === undefined) counts[key] = 0;
  counts[key] += 1;
}
for (const key of ["a", "b", "a"]) step(key);
assert.sameValue(JSON.stringify(counts), '{"a":2,"b":1}');
console.log("assignments-record-counter:ok");
