/*---
description: "Control for map-class-replaced-key: Replacing an object key in a class field does not replace the old Map entry."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions, ts-unknown, ts-tuples, ts-null-undefined, ts-numbers]
---*/
// Map keys cross a mutable class field; node gives the replacement its own entry and preserves the held old key until deletion.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
class KeySlot {
  key: object;
  constructor(key: object) { this.key = key; }
}
const pairs: [object, object][] = [[{ id: 2 }, { id: 2 }], [[2], [2]], [() => 2, () => 2], [new MapKey(2), new MapKey(2)]];
const values: unknown[] = [undefined, -0, NaN, null, { marker: 2 }];
for (const [initial, replacement] of pairs) for (const value of values) {
  const slot = new KeySlot(initial), old = slot.key, table = new Map<object, unknown>();
  assert.sameValue(table.set(slot.key, value), table);
  assert.sameValue(table.get(old), value); assert.sameValue(table.has(old), true);
  slot.key = replacement; assert.sameValue(slot.key, replacement); assert.sameValue(old, initial);
  assert.sameValue(table.get(slot.key), undefined); assert.sameValue(table.has(slot.key), false);
  assert.sameValue(table.delete(slot.key), false);
  assert.sameValue(table.get(old), value); assert.sameValue(table.has(old), true);
  assert.sameValue(table.set(slot.key, replacement), table);
  assert.sameValue(table.get(slot.key), replacement); assert.sameValue(table.has(slot.key), true);
  assert.sameValue(table.get(old), value);
  assert.sameValue(table.delete(old), true); assert.sameValue(table.delete(old), false);
  assert.sameValue(table.get(old), undefined); assert.sameValue(table.has(old), false);
  assert.sameValue(table.get(slot.key), replacement); assert.sameValue(table.has(slot.key), true);
  slot.key = old; assert.sameValue(table.get(slot.key), undefined); assert.sameValue(table.has(slot.key), false);
  assert.sameValue(table.delete(replacement), true); assert.sameValue(table.delete(replacement), false);
  assert.sameValue(table.get(replacement), undefined); assert.sameValue(table.has(replacement), false);
}
