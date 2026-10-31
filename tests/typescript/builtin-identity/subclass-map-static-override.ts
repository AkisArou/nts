/*---
description: A Map subclass overrides groupBy, whose result is an ordinary Map.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-instanceof, ts-map-set, ts-arrays, ts-functions, ts-override]
---*/
// Route: a generic Map subclass overrides groupBy; node returns an intrinsic Map, not the subclass.
let calls = 0;
class IdentityMap extends Map<number, number> {
  static override groupBy<K, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Map<K, T[]> {
    calls++;
    return super.groupBy(items, keySelector);
  }
}
function check(n: number): void {
  const before = calls;
  const result: Map<number, number[]> = IdentityMap.groupBy([n, n + 2], (value: number) => value % 2);
  assert.sameValue(calls - before, 1);
  assert.sameValue(result.size, 1);
  const group = result.get(n % 2);
  if (group === undefined) throw new Error("missing group");
  assert.sameValue(group.length, 2);
  assert.sameValue(group[0], n);
  assert.sameValue(group[1], n + 2);
  assert.sameValue(result instanceof Map, true);
  assert.sameValue(result instanceof IdentityMap, false);
}
for (const n of [0, 1, 4, 7]) check(n);
