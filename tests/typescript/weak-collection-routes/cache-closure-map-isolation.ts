/*---
description: A returned interface keeps its captured WeakMap independent from another closure while aliases share the same cache.
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-interfaces, ts-functions, ts-closures, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-null-undefined]
---*/
// A WeakMap is captured behind an interface return; node preserves each closure's own entries and shares changes only through aliases of that closure.
interface ObjectCache { put(key: object, value: object): void; read(key: object): object | undefined; present(key: object): boolean; remove(key: object): boolean; }
function makeObjectCache(): ObjectCache {
  const cache: WeakMap<object, object> = new WeakMap();
  return {
    put(key, value) { assert.sameValue(cache.set(key, value), cache); },
    read(key) { return cache.get(key); },
    present(key) { return cache.has(key); },
    remove(key) { return cache.delete(key); }
  };
}
class ClosureKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new ClosureKey(), new ClosureKey()]];
for (const [key, twin] of pairs) {
  const left = makeObjectCache(), right = makeObjectCache(), alias: ObjectCache = left, first = { value: 1 }, second = { value: 2 };
  assert.sameValue(left.read(key), undefined); assert.sameValue(left.present(key), false); assert.sameValue(left.remove(key), false);
  left.put(key, first); right.put(key, second);
  assert.sameValue(alias.read(key), first); assert.sameValue(right.read(key), second);
  assert.sameValue(left.present(key), true); assert.sameValue(right.present(key), true);
  assert.sameValue(left.read(twin), undefined); assert.sameValue(left.present(twin), false); assert.sameValue(left.remove(twin), false);
  alias.put(twin, second); assert.sameValue(left.read(twin), second); assert.sameValue(left.present(twin), true);
  assert.sameValue(alias.remove(key), true); assert.sameValue(left.remove(key), false);
  assert.sameValue(left.read(key), undefined); assert.sameValue(left.present(key), false);
  assert.sameValue(right.read(key), second); assert.sameValue(right.present(key), true); assert.sameValue(left.read(twin), second);
  assert.sameValue(left.remove(twin), true); assert.sameValue(left.remove(twin), false); assert.sameValue(left.read(twin), undefined); assert.sameValue(left.present(twin), false);
  assert.sameValue(right.remove(key), true); assert.sameValue(right.remove(key), false); assert.sameValue(right.read(key), undefined); assert.sameValue(right.present(key), false);
}
