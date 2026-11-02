/*---
description: Replacing a declared WeakMap field changes the current cache without changing a retained collection alias.
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-class, ts-class-fields, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-functions, ts-null-undefined]
---*/
// WeakMap collections travel through a replaceable class field; node keeps the old cache alive by its alias and isolates the replacement's writes and deletes.
class CacheHolder { cache: WeakMap<object, object> = new WeakMap(); }
class FieldKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new FieldKey(), new FieldKey()]];
for (const [key, twin] of pairs) {
  const holder = new CacheHolder(), alias: CacheHolder = holder, original = holder.cache, first = { value: 1 }, second = { value: 2 };
  assert.sameValue(holder.cache.set(key, first), original); assert.sameValue(holder.cache.get(key), first); assert.sameValue(holder.cache.has(key), true);
  alias.cache = new WeakMap<object, object>();
  assert.sameValue(alias.cache, holder.cache); assert.notSameValue(holder.cache, original);
  assert.sameValue(holder.cache.get(key), undefined); assert.sameValue(holder.cache.has(key), false); assert.sameValue(holder.cache.delete(key), false);
  assert.sameValue(holder.cache.set(key, second), holder.cache); assert.sameValue(alias.cache.get(key), second); assert.sameValue(alias.cache.has(key), true);
  assert.sameValue(original.get(key), first); assert.sameValue(original.has(key), true);
  assert.sameValue(holder.cache.get(twin), undefined); assert.sameValue(holder.cache.has(twin), false); assert.sameValue(holder.cache.delete(twin), false);
  assert.sameValue(alias.cache.delete(key), true); assert.sameValue(holder.cache.delete(key), false);
  assert.sameValue(holder.cache.get(key), undefined); assert.sameValue(holder.cache.has(key), false);
  assert.sameValue(original.get(key), first); assert.sameValue(original.has(key), true);
  assert.sameValue(original.delete(key), true); assert.sameValue(original.delete(key), false);
  assert.sameValue(original.get(key), undefined); assert.sameValue(original.has(key), false);
}
