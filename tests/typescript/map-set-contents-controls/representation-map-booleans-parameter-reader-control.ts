/*---
description: Control for representation-map-booleans-parameter-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-booleans-parameter-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function read(map: Map<string, boolean>, key: string): unknown { return map.get(key); }
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
