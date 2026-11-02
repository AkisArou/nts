/*---
description: "Control for set-class-replaced-key: Replacing a class field containing a Set key leaves the original object membership intact."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-set, ts-arrays, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions, ts-tuples]
---*/
// A mutable class field carries a Set key; node treats its replacement as a different key while the old alias remains a member.
class SetKey { value: number; constructor(value: number) { this.value = value; } }
class KeySlot { key: object; constructor(key: object) { this.key = key; } }
const pairs: [object, object][] = [[{ id: 2 }, { id: 2 }], [[2], [2]], [() => 2, () => 2], [new SetKey(2), new SetKey(2)]];
for (const [initial, replacement] of pairs) {
  const slot = new KeySlot(initial), old = slot.key, members = new Set<object>();
  assert.sameValue(members.add(slot.key), members); assert.sameValue(members.has(old), true);
  slot.key = replacement; assert.sameValue(slot.key, replacement); assert.sameValue(old, initial);
  assert.sameValue(members.has(slot.key), false); assert.sameValue(members.delete(slot.key), false);
  assert.sameValue(members.has(old), true);
  assert.sameValue(members.add(slot.key), members); assert.sameValue(members.has(slot.key), true); assert.sameValue(members.has(old), true);
  assert.sameValue(members.delete(old), true); assert.sameValue(members.delete(old), false); assert.sameValue(members.has(old), false);
  assert.sameValue(members.has(slot.key), true);
  slot.key = old; assert.sameValue(members.has(slot.key), false);
  assert.sameValue(members.add(slot.key), members); assert.sameValue(members.has(old), true);
  assert.sameValue(members.delete(replacement), true); assert.sameValue(members.delete(replacement), false);
  assert.sameValue(members.has(replacement), false); assert.sameValue(members.has(slot.key), true);
}
