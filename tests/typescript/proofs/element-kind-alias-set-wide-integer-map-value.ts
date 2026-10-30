/*---
description: A Set retrieved from a Map value receives a wide integer before its original name is read.
features: [ts-proof-element-kind, ts-route-alias, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-narrowing, ts-null-undefined]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: a checked Map.get result aliases the Set and inserts an integer beyond 32 bits.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const owners = new Map<string, Set<number>>([["active", items]]);
  const alias = owners.get("active");
  if (alias !== undefined && n > 0) alias.add(4294967296 + n);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
