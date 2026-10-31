/*---
description: Control for representation-set-booleans-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-booleans-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(flag: boolean): void {
  const set = new Set<boolean>();
  set.add(flag); set.add(!flag);
  const reader: Set<boolean> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(flag), true);
  assert.compareArray<unknown>([...reader], [flag, !flag]);
  assert.compareArray([...reader].map(value => typeof value), ["boolean", "boolean"]);
}
for (const flag of [false, true]) check(flag);
