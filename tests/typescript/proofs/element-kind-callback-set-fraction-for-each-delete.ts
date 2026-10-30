/*---
description: Set.forEach skips a deleted integer and visits the fraction appended by its callback.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-arrow-functions, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the callback on 1 deletes unvisited 2 and adds one fraction, so mutation is bounded.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  let visits = 0;
  items.forEach((value, duplicate, owner) => {
    assert.sameValue(duplicate, value);
    assert.sameValue(owner, items);
    assert.sameValue(value, visits === 0 ? 1 : n > 0 ? n + 0.5 : 2);
    visits++;
    if (value === 1 && n > 0) { owner.delete(2); owner.add(n + 0.5); }
  });
  assert.sameValue(visits, 2);
  assert.sameValue(items.has(2), n <= 0);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
