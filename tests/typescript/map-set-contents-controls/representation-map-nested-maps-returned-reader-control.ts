/*---
description: Control for representation-map-nested-maps-returned-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread, ts-numbers]
---*/
// Paired case: ../map-set-contents/representation-map-nested-maps-returned-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function view(map: Map<string, Map<string, number>>): Map<string, Map<string, number>> { return map; }
function check(n: number): void {
  const first = new Map<string, number>([["value", n]]);
  const second = new Map<string, number>([["value", n + 1]]);
  const map = new Map<string, Map<string, number>>();
  map.set("first", first); map.set("second", second);
  const reader = view(map);
  first.set("later", n + 2);
  const value = reader.get("first");
  assert.sameValue(typeof value, "object");
  if (value === undefined) throw new Test262Error("inner Map required");
  assert.sameValue<unknown>(value, first); assert.sameValue(value instanceof Map, true);
  assert.sameValue(value.get("value"), n); assert.sameValue(typeof value.get("value"), "number");
  assert.sameValue(value.get("later"), n + 2); assert.sameValue(value.size, 2);
  assert.compareArray([...value.keys()], ["value", "later"]);
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const n of [-3, 0, 7]) check(n);
