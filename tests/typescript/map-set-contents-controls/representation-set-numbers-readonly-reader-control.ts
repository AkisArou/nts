/*---
description: Control for representation-set-numbers-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-numbers-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const set = new Set<number>();
  set.add(n); set.add(42.5); set.add(n);
  const reader: Set<number> = set;
  const expected = n === 0 ? 0 : n;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(n), true);
  assert.compareArray<unknown>([...reader], [expected, 42.5]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "number"]);
}
for (const n of [-0, 0, NaN, 1.5, 2147483648, 4294967297, 9007199254740994, -9007199254740994]) check(n);
