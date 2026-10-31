/*---
description: Control for representation-set-objects-class-field-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-class, ts-class-fields, ts-object-type, ts-instanceof, ts-narrowing, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/representation-set-objects-class-field-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
class Box {
  value: number;
  constructor(value: number) { this.value = value; }
}
class Reader {
  values: Set<Box>;
  constructor(values: Set<Box>) { this.values = values; }
}
function check(n: number): void {
  const first = new Box(n), second = new Box(n);
  const set = new Set<Box>(); set.add(first); set.add(second);
  const reader = new Reader(set);
  first.value = n + 10;
  const seen = [...reader.values];
  assert.sameValue(reader.values.size, 2);
  assert.compareArray<unknown>(seen, [first, second]);
  assert.compareArray(seen.map(value => typeof value), ["object", "object"]);
  const value = seen[0];
  if (!(value instanceof Box)) throw new Test262Error("Box required");
  assert.sameValue(value.value, n + 10); assert.sameValue(second.value, n);
}
for (const n of [-3, 0, 7]) check(n);
