/*---
description: A recursive writer inserts beyond 32 bits into the caller's initially numeric Set.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-spread]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: three recursive calls lead to the only wide Set insertion.
function read(items: Set<number>): number {
  const values = [...items];
  return values[values.length - 1];
}
function insert(items: Set<number>, n: number, depth: number): void {
  if (depth > 0) { insert(items, n, depth - 1); return; }
  if (n > 0) items.add(4294967296 + n);
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  insert(items, n, 3);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
