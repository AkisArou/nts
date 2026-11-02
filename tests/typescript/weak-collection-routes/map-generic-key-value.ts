/*---
description: "An object-constrained generic helper keeps WeakMap key identity and value identity at several instantiations."
features: [ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-generics, ts-generic-constraints, ts-functions, ts-class, ts-class-fields, ts-numbers, ts-strings, ts-function-types, ts-null-undefined]
---*/
// WeakMap<K, V> lives in an object-constrained generic helper; node preserves each K alias, its separate peer and the exact V result.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
function exercise<K extends object, V>(key: K, alias: K, peer: K, value: V): void {
  const table: WeakMap<K, V> = new WeakMap<K, V>();
  assert.sameValue(key, alias); assert.sameValue(key === peer, false);
  assert.sameValue(table.get(peer), undefined); assert.sameValue(table.has(peer), false); assert.sameValue(table.delete(peer), false);
  assert.sameValue(table.set(key, value), table); assert.sameValue(table.get(alias), value); assert.sameValue(table.has(alias), true);
  assert.sameValue(table.get(peer), undefined); assert.sameValue(table.has(peer), false);
  assert.sameValue(table.set(peer, value), table); assert.sameValue(table.get(peer), value); assert.sameValue(table.has(peer), true);
  assert.sameValue(table.delete(alias), true); assert.sameValue(table.delete(key), false);
  assert.sameValue(table.get(key), undefined); assert.sameValue(table.has(alias), false);
  assert.sameValue(table.get(peer), value); assert.sameValue(table.has(peer), true);
  assert.sameValue(table.set(alias, value), table); assert.sameValue(table.get(key), value); assert.sameValue(table.has(key), true);
  assert.sameValue(table.delete(peer), true); assert.sameValue(table.delete(peer), false);
  assert.sameValue(table.get(peer), undefined); assert.sameValue(table.has(peer), false);
}
for (const value of [-0, 3.5, NaN]) {
  const record = { value }, array = [value], callback = () => value, instance = new MapKey(value);
  exercise(record, record, { value }, value);
  exercise(array, array, [value], array);
  exercise(callback, callback, () => value, callback);
  exercise(instance, instance, new MapKey(value), instance);
  exercise(record, record, { value }, undefined);
  exercise(array, array, [value], 'generic');
}
