/*---
description: A live Set loop visits the fractional entry appended after its integer entries.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: for-of appends once at value 2 and visits the new fraction before finishing.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  let visits = 0;
  for (const value of items) {
    assert.sameValue(value, visits === 0 ? 1 : visits === 1 ? 2 : n + 0.5);
    visits++;
    if (value === 2 && n > 0) items.add(n + 0.5);
  }
  assert.sameValue(visits, n > 0 ? 3 : 2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
