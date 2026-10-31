/*---
description: A readonly unknown-valued parameter reads both boolean representations from a concrete Map.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread]
---*/
// Write: Map<string, boolean>.set; read: a readonly unknown-valued function parameter.
// Node preserves the exact stored values, runtime kinds and insertion order.
function read(map: ReadonlyMap<string, unknown>, key: string): unknown { return map.get(key); }
function check(flag: boolean): void {
  const map = new Map<string, boolean>();
  map.set("first", flag); map.set("second", !flag);
  const first = read(map, "first"), second = read(map, "second");
  assert.sameValue(first, flag); assert.sameValue(second, !flag);
  assert.sameValue(typeof first, "boolean"); assert.sameValue(typeof second, "boolean");
  assert.sameValue(map.size, 2);
  assert.compareArray([...map.keys()], ["first", "second"]);
}
for (const flag of [false, true]) check(flag);
