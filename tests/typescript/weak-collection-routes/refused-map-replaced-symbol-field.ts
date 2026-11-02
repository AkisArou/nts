/*---
description: A WeakMap key field can change from a held key to a registered symbol without losing the earlier entry.
features: [ts-weak-collection-routes, ts-weak-collection-route-refused, ts-map-set, ts-unions, ts-symbols, ts-errors, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-class, ts-class-fields]
---*/
// WeakMap keys cross a mutable class field: node rejects the registered replacement, quietly misses it and retains the original key by identity.
class KeySlot {
  key: object | symbol; table: WeakMap<object | symbol, unknown> = new WeakMap<object | symbol, unknown>();
  constructor(key: object | symbol) { this.key = key; }
}
function put(slot: KeySlot, value: unknown): WeakMap<object | symbol, unknown> { return slot.table.set(slot.key, value); }
const pairs: [object | symbol, object | symbol][] = [[{ id: 1 }, { id: 1 }], [[1], [1]], [() => 1, () => 1], [Symbol("s"), Symbol("s")], [Symbol.iterator, Symbol.toStringTag]];
for (const [key, peer] of pairs) for (const registeredName of ["", "weak", "same"]) {
  const slot = new KeySlot(key), alias: KeySlot = slot, value = { payload: registeredName };
  assert.sameValue(put(slot, value), slot.table); assert.sameValue(slot.table.get(key), value); assert.sameValue(slot.table.has(key), true);
  assert.sameValue(slot.table.get(peer), undefined); assert.sameValue(slot.table.has(peer), false); assert.sameValue(slot.table.delete(peer), false);
  alias.key = Symbol.for(registeredName); assert.sameValue(slot.key, Symbol.for(registeredName));
  assert.sameValue(slot.table.get(slot.key), undefined); assert.sameValue(slot.table.has(slot.key), false); assert.sameValue(slot.table.delete(slot.key), false);
  assert.throws(TypeError, () => put(slot, peer));
  assert.sameValue(slot.table.get(slot.key), undefined); assert.sameValue(slot.table.has(slot.key), false); assert.sameValue(slot.table.delete(slot.key), false);
  assert.sameValue(slot.table.get(key), value); assert.sameValue(slot.table.has(key), true);
  alias.key = key; assert.sameValue(slot.key, key); assert.sameValue(slot.table.get(slot.key), value);
  assert.sameValue(slot.table.delete(slot.key), true); assert.sameValue(slot.table.delete(key), false); assert.sameValue(slot.table.get(key), undefined); assert.sameValue(slot.table.has(key), false);
}
