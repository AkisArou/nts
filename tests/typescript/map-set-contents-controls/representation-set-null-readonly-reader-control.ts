/*---
description: Control for representation-set-null-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-null-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const set = new Set<number | null>(); set.add(n); set.add(null);
  const reader: Set<number | null> = set;
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(null), true);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n, null]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "object"]);
}
for (const n of [-0, NaN, 7]) check(n);
