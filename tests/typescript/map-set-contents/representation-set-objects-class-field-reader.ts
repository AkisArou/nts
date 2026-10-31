/*---
description: A class field with an object-element readonly Set view retains identities and live concrete fields.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-class, ts-class-fields, ts-object-type, ts-instanceof, ts-narrowing, ts-spread, ts-arrow-functions]
---*/
// Write: Set<Box>.add; read: an object-element readonly class field.
// Node preserves the exact stored values, runtime kinds and insertion order.
class Box {
  value: number;
  constructor(value: number) { this.value = value; }
}
class Reader {
  values: ReadonlySet<object>;
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
