/*---
description: A returned readonly Map view retains nested numeric Maps and observes later writes through the concrete inner alias.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread, ts-numbers]
---*/
// Write: Map<string, Map<string, number>> and its concrete inner Map; read: a returned readonly view with nested unknown-valued Maps.
// Node preserves the exact stored values, runtime kinds and insertion order.
function view(map: Map<string, Map<string, number>>): ReadonlyMap<string, ReadonlyMap<string, unknown>> { return map; }
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
