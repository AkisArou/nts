/*---
description: Control for representation-map-objects-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-class, ts-class-fields, ts-object-type, ts-instanceof, ts-narrowing, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-objects-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
class Box {
  value: number;
  constructor(value: number) { this.value = value; }
}
function check(n: number): void {
  const first = new Box(n), second = new Box(n);
  const map = new Map<string, Box>();
  map.set("first", first); map.set("second", second);
  const reader: Map<string, Box> = map;
  first.value = n + 10;
  const value = reader.get("first");
  assert.sameValue(typeof value, "object");
  if (!(value instanceof Box)) throw new Test262Error("Box required");
  assert.sameValue(value, first); assert.notSameValue(value, second);
  assert.sameValue(value.value, n + 10); assert.sameValue(second.value, n);
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const n of [-3, 0, 7]) check(n);
