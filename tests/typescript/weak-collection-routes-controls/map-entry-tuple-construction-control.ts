/*---
description: "Control for map-entry-tuple-construction: Typed entry tuples preserve Map constructor aliases, duplicate-key overwrites and distinct peers."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-tuples, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-null-undefined, ts-numbers, ts-symbols]
---*/
// Entry tuples carry keys and values into a Map constructor; node gives the repeated identity its last value and retains the separate equal-content key.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
const triples: [object, object, object][] = [[{ id: 7 }, { id: 7 }, { id: 7 }], [[7], [7], [7]], [() => 7, () => 7, () => 7], [new MapKey(7), new MapKey(7), new MapKey(7)]];
const values: unknown[] = [undefined, null, -0, NaN, Symbol('entries'), { value: 7 }];
for (const [key, peer, absent] of triples) for (const value of values) {
  const alias = key;
  const entries: [object, unknown][] = [[key, peer], [peer, value], [alias, undefined]];
  const table: Map<object, unknown> = new Map<object, unknown>(entries);
  assert.sameValue(table.get(key), undefined); assert.sameValue(table.get(alias), undefined); assert.sameValue(table.has(key), true);
  assert.sameValue(table.get(peer), value); assert.sameValue(table.has(peer), true);
  assert.sameValue(table.get(absent), undefined); assert.sameValue(table.has(absent), false); assert.sameValue(table.delete(absent), false);
  assert.sameValue(table.set(alias, value), table); assert.sameValue(table.get(key), value); assert.sameValue(table.has(alias), true);
  assert.sameValue(table.delete(key), true); assert.sameValue(table.delete(alias), false);
  assert.sameValue(table.get(alias), undefined); assert.sameValue(table.has(key), false);
  assert.sameValue(table.get(peer), value); assert.sameValue(table.has(peer), true);
  assert.sameValue(table.delete(peer), true); assert.sameValue(table.delete(peer), false);
  assert.sameValue(table.get(peer), undefined); assert.sameValue(table.has(peer), false);
  assert.sameValue(entries[0][0], key); assert.sameValue(entries[1][0], peer); assert.sameValue(entries[2][0], key);
}
