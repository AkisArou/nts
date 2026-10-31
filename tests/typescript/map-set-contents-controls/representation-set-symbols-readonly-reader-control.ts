/*---
description: Control for representation-set-symbols-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-symbols, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-symbols-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(label: string): void {
  const first = Symbol(label), second = Symbol(label);
  const set = new Set<symbol>(); set.add(first); set.add(second); set.add(first);
  const reader: Set<symbol> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(first), true); assert.sameValue(reader.has(second), true);
  assert.compareArray<unknown>([...reader], [first, second]);
  assert.compareArray([...reader].map(value => typeof value), ["symbol", "symbol"]);
}
for (const label of ["", "7", "contents"]) check(label);
