/*---
description: Set.forEach visits a newly appended wide integer after deleting an already visited entry.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-arrow-functions, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the callback on 2 removes already visited 1 and appends one integer beyond 32 bits.
function read(items: Set<number>): number {
  const values = Array.from(items);
  return values[values.length - 1];
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  let visits = 0;
  items.forEach((value, duplicate, owner) => {
    assert.sameValue(duplicate, value);
    assert.sameValue(owner, items);
    assert.sameValue(value, visits === 0 ? 1 : visits === 1 ? 2 : 4294967296 + n);
    visits++;
    if (value === 2 && n > 0) { owner.delete(1); owner.add(4294967296 + n); }
  });
  assert.sameValue(visits, n > 0 ? 3 : 2);
  assert.sameValue(items.size, 2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
