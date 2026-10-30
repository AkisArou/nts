/*---
description: A direct callee adds a fractional value after the caller creates a numeric Set.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the direct helper conditionally inserts a fraction through its Set parameter.
function read(items: Set<number>): number {
  const values = Array.from(items);
  return values[values.length - 1];
}
function insert(items: Set<number>, n: number): void {
  if (n > 0) items.add(n + 0.25);
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  insert(items, n);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.25 : 2);
}
