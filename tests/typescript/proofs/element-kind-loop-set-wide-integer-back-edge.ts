/*---
description: A loop back edge carries an integer beyond 32 bits into the next Set insertion.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the first add repeats 2; later back edges supply 2^32 and successively wider integers.
function read(items: Set<number>): number {
  const values = Array.from(items);
  return values[values.length - 1];
}
function observe(turns: number): number {
  const items = new Set<number>([1, 2]);
  let value = 2;
  for (let i = 0; i < turns; i++) {
    items.add(value);
    value = 4294967296 + i;
  }
  return read(items);
}
for (const n of [0, 1, 2, 3, 5]) {
  const result = observe(n);
  assert.sameValue(result, n < 2 ? 2 : 4294967296 + n - 2);
}
