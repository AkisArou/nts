/*---
description: Control for representation-set-nested-maps-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread, ts-numbers, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-nested-maps-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const first = new Map<string, number>([["value", n]]);
  const second = new Map<string, number>([["value", n + 1]]);
  const set = new Set<Map<string, number>>(); set.add(first); set.add(second);
  const reader: Set<Map<string, number>> = set;
  first.set("later", n + 2);
  const seen = [...reader];
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(first), true);
  assert.compareArray<unknown>(seen, [first, second]);
  assert.compareArray(seen.map(value => typeof value), ["object", "object"]);
  assert.sameValue(seen[0].get("value"), n); assert.sameValue(typeof seen[0].get("value"), "number");
  assert.sameValue(seen[0].get("later"), n + 2); assert.sameValue(seen[0].size, 2);
  assert.sameValue(seen[1].get("value"), n + 1); assert.sameValue(seen[1].size, 1);
  assert.compareArray([...seen[0].keys()], ["value", "later"]);
}
for (const n of [-3, 0, 7]) check(n);
