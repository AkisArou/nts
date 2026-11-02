/*---
description: "Strong-collection control for cache-map-array-elements: Map values stored in array elements retain independent contents when their slots are swapped."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-caches, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions, ts-null-undefined]
---*/
// Maps cross typed array elements; node follows each collection when slots swap, preserves key identity and returns true then false for removal.
class ArrayCacheKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new ArrayCacheKey(), new ArrayCacheKey()]];
for (const [key, twin] of pairs) {
  const caches: Map<object, object>[] = [new Map(), new Map()];
  const values: object[] = [{ slot: 0 }, { slot: 1 }];
  for (const index of [0, 1]) {
    assert.sameValue(caches[index].set(key, values[index]), caches[index]);
    assert.sameValue(caches[index].get(key), values[index]); assert.sameValue(caches[index].has(key), true);
    assert.sameValue(caches[index].get(twin), undefined); assert.sameValue(caches[index].has(twin), false); assert.sameValue(caches[index].delete(twin), false);
  }
  const first = caches[0]; caches[0] = caches[1]; caches[1] = first;
  assert.sameValue(caches[1], first); assert.notSameValue(caches[0], first);
  for (const index of [0, 1]) {
    assert.sameValue(caches[index].get(key), values[1 - index]); assert.sameValue(caches[index].has(key), true);
    assert.sameValue(caches[index].delete(key), true); assert.sameValue(caches[index].delete(key), false);
    assert.sameValue(caches[index].get(key), undefined); assert.sameValue(caches[index].has(key), false);
  }
}
