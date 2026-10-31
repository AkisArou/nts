/*---
description: Control for representation-map-numbers-interface-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-interfaces, ts-unknown, ts-numbers, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-numbers-interface-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
interface Reader { map: Map<string, number>; }
function check(n: number): void {
  const map = new Map<string, number>();
  map.set("value", n); map.set("tail", 42.5);
  const reader: Reader = { map };
  const value = reader.map.get("value");
  assert.sameValue<unknown>(value, n);
  assert.sameValue(typeof value, "number");
  assert.sameValue(reader.map.size, 2);
  assert.sameValue(reader.map.has("value"), true);
  assert.compareArray([...reader.map.keys()], ["value", "tail"]);
  assert.compareArray<unknown>([...reader.map.values()], [n, 42.5]);
}
for (const n of [-0, 0, NaN, 1.5, 2147483648, 4294967297, 9007199254740994, -9007199254740994]) check(n);
