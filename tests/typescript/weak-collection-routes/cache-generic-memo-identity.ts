/*---
description: An object-constrained generic cache computes once per identity and recomputes after deletion.
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-generics, ts-generic-constraints, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-null-undefined]
---*/
// WeakMap keys cross a generic parameter; node reuses the exact cached object for aliases, separates equal contents and counts one new computation after deletion.
interface MemoEntry<T> { key: T; serial: number; }
function memo<T extends object>(cache: WeakMap<T, MemoEntry<T>>, key: T, expected: MemoEntry<T> | undefined, count: { value: number }): MemoEntry<T> {
  const found = cache.get(key); assert.sameValue(found, expected);
  if (found !== undefined) return found;
  const created: MemoEntry<T> = { key, serial: ++count.value };
  assert.sameValue(cache.set(key, created), cache); return created;
}
class MemoKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new MemoKey(), new MemoKey()]];
for (const [key, twin] of pairs) {
  const cache: WeakMap<object, MemoEntry<object>> = new WeakMap(), count = { value: 0 }, alias: object = key;
  const first = memo(cache, key, undefined, count);
  assert.sameValue(first.key, key); assert.sameValue(first.serial, 1); assert.sameValue(count.value, 1);
  assert.sameValue(memo(cache, alias, first, count), first); assert.sameValue(count.value, 1);
  const second = memo(cache, twin, undefined, count);
  assert.notSameValue(second, first); assert.sameValue(second.key, twin); assert.sameValue(second.serial, 2); assert.sameValue(count.value, 2);
  assert.sameValue(cache.has(key), true); assert.sameValue(cache.has(twin), true);
  assert.sameValue(cache.delete(alias), true); assert.sameValue(cache.delete(key), false);
  assert.sameValue(cache.get(key), undefined); assert.sameValue(cache.has(key), false); assert.sameValue(cache.get(twin), second);
  const rebuilt = memo(cache, key, undefined, count);
  assert.notSameValue(rebuilt, first); assert.sameValue(rebuilt.key, key); assert.sameValue(rebuilt.serial, 3); assert.sameValue(count.value, 3);
  assert.sameValue(memo(cache, twin, second, count), second); assert.sameValue(count.value, 3);
  assert.sameValue(cache.delete(key), true); assert.sameValue(cache.delete(key), false); assert.sameValue(cache.get(key), undefined); assert.sameValue(cache.has(key), false);
  assert.sameValue(cache.delete(twin), true); assert.sameValue(cache.delete(twin), false); assert.sameValue(cache.get(twin), undefined); assert.sameValue(cache.has(twin), false);
}
