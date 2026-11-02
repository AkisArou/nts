/*---
description: A WeakMap in an interface caches undefined using membership and computes again only after its key is removed.
features: [ts-weak-collection-routes, ts-weak-collection-route-caches, ts-interfaces, ts-functions, ts-arrays, ts-tuples, ts-iteration, ts-objects, ts-class, ts-class-fields, ts-null-undefined, ts-numbers]
---*/
// A WeakMap crosses an interface field; node treats stored undefined as present, avoids duplicate computations and recomputes for a deleted identity.
interface NegativeCache { values: WeakMap<object, undefined>; evaluations: number; }
function cachedUndefined(cache: NegativeCache, key: object, expectedHit: boolean): undefined {
  const hit = cache.values.has(key); assert.sameValue(hit, expectedHit);
  if (!hit) { cache.evaluations++; assert.sameValue(cache.values.set(key, undefined), cache.values); }
  const result = cache.values.get(key); assert.sameValue(result, undefined); return result;
}
class NegativeKey { value: number = 7; }
const pairs: [object, object][] = [[{ value: 7 }, { value: 7 }], [[7], [7]], [() => 7, () => 7], [new NegativeKey(), new NegativeKey()]];
for (const [key, twin] of pairs) {
  const cache: NegativeCache = { values: new WeakMap(), evaluations: 0 }, alias: object = key;
  assert.sameValue(cachedUndefined(cache, key, false), undefined); assert.sameValue(cache.evaluations, 1);
  assert.sameValue(cachedUndefined(cache, alias, true), undefined); assert.sameValue(cache.evaluations, 1);
  assert.sameValue(cachedUndefined(cache, twin, false), undefined); assert.sameValue(cache.evaluations, 2);
  assert.sameValue(cache.values.delete(alias), true); assert.sameValue(cache.values.delete(key), false);
  assert.sameValue(cache.values.get(key), undefined); assert.sameValue(cache.values.has(key), false);
  assert.sameValue(cache.values.get(twin), undefined); assert.sameValue(cache.values.has(twin), true);
  assert.sameValue(cachedUndefined(cache, key, false), undefined); assert.sameValue(cache.evaluations, 3);
  assert.sameValue(cachedUndefined(cache, twin, true), undefined); assert.sameValue(cache.evaluations, 3);
  assert.sameValue(cache.values.delete(key), true); assert.sameValue(cache.values.delete(key), false); assert.sameValue(cache.values.has(key), false); assert.sameValue(cache.values.get(key), undefined);
  assert.sameValue(cache.values.delete(twin), true); assert.sameValue(cache.values.delete(twin), false); assert.sameValue(cache.values.has(twin), false); assert.sameValue(cache.values.get(twin), undefined);
}
