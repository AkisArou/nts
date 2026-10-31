/*---
description: Control for subclass-map-static-inherited; call Map.groupBy directly; adjust the override counter if present.
features: [ts-builtin-identity, ts-builtin-subclass, ts-iteration, ts-class, ts-inheritance, ts-static, ts-instanceof, ts-map-set, ts-arrays, ts-functions]
---*/
// Paired case: ../builtin-identity/subclass-map-static-inherited.ts.
// Change: Call Map.groupBy directly; adjust the override counter if present.
class IdentityMap extends Map<number, number> {}
function check(n: number): void {

  const result: Map<number, number[]> = Map.groupBy([n, n + 2], (value: number) => value % 2);

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
