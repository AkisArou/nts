/*---
description: Control for representation-set-bigints-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-bigint, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-bigints-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: bigint): void {
  const set = new Set<bigint>();
  set.add(n); set.add(n + 1n); set.add(n);
  const reader: Set<bigint> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(n), true); assert.sameValue(reader.has(n + 1n), true);
  assert.compareArray<unknown>([...reader], [n, n + 1n]);
  assert.compareArray([...reader].map(value => typeof value), ["bigint", "bigint"]);
}
for (const n of [0n, -1n, 2147483648n, 9007199254740993n, 1267650600228229401496703205376n]) check(n);
