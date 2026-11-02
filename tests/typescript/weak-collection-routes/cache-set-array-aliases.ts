/*---
description: Typed WeakSet array elements preserve one repeated collection alias and isolate another collection with equal-shaped keys.
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-functions]
---*/
// WeakSets cross array elements, including two slots for one collection; node shares writes and deletion through that alias and keeps the other set independent.
class SetArrayKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new SetArrayKey(), new SetArrayKey()]];
for (const [key, twin] of pairs) {
  const caches: WeakSet<object>[] = [new WeakSet(), new WeakSet()];
  const first = caches[0]; assert.sameValue(caches.push(first), 3);
  assert.sameValue(caches[2], first); assert.notSameValue(caches[1], first);
  assert.sameValue(caches[0].add(key), caches[0]); assert.sameValue(caches[2].add(key), caches[2]);
  assert.sameValue(caches[1].add(twin), caches[1]);
  for (const index of [0, 1, 2]) {
    assert.sameValue(caches[index].has(key), index !== 1); assert.sameValue(caches[index].has(twin), index === 1);
  }
  assert.sameValue(caches[2].delete(key), true); assert.sameValue(caches[0].delete(key), false);
  assert.sameValue(caches[0].has(key), false); assert.sameValue(caches[2].has(key), false);
  assert.sameValue(caches[1].has(twin), true); assert.sameValue(caches[1].has(key), false); assert.sameValue(caches[1].delete(key), false);
  assert.sameValue(caches[1].delete(twin), true); assert.sameValue(caches[1].delete(twin), false);
  for (const index of [0, 1, 2]) {
    assert.sameValue(caches[index].has(key), false); assert.sameValue(caches[index].has(twin), false); assert.sameValue(caches[index].delete(twin), false);
  }
}
