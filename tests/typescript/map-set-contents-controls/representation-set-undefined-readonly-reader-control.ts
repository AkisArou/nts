/*---
description: Control for representation-set-undefined-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-undefined-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const set = new Set<number | undefined>(); set.add(n); set.add(undefined);
  const reader: Set<number | undefined> = set;
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(undefined), true);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n, undefined]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "undefined"]);
  assert.sameValue(set.delete(undefined), true);
  assert.sameValue(reader.has(undefined), false); assert.sameValue(reader.size, 1);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n]);
}
for (const n of [-0, 0, 7]) check(n);
