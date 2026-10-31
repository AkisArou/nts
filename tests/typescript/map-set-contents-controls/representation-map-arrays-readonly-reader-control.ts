/*---
description: Control for representation-map-arrays-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-numbers, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-arrays-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const first = [n, -0, NaN], second = [n + 1];
  const map = new Map<string, number[]>();
  map.set("first", first); map.set("second", second);
  const reader: Map<string, number[]> = map;
  first.push(n + 2);
  const value = reader.get("first");
  assert.sameValue(typeof value, "object");
  if (value === undefined) throw new Test262Error("array required");
  assert.sameValue(value, first); assert.sameValue(Array.isArray(value), true);
  assert.sameValue(value.length, 4);
  assert.compareArray(value, [n, -0, NaN, n + 2]);
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const n of [-3, 0, 7]) check(n);
