/*---
description: A switch joins integer-only Set contents with two distinct wide insertion paths.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: separate switch arms store 2^32+1 or 2^32+2n before their common read.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  switch (n) {
    case -1: case 0: break;
    case 1: items.add(4294967297); break;
    default: if (n > 0) items.add(4294967296 + 2 * n);
  }
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n <= 0 ? 2 : n === 1 ? 4294967297 : 4294967296 + 2 * n);
}
