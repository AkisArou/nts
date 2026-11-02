/*---
description: "Control for map-return-independent: Separately returned typed Maps keep independent values and deletion state for the same keys."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-tuples, ts-null-undefined, ts-numbers]
---*/
// A factory returns Map<object, unknown>; node preserves both returned identities and keeps their same-key contents independent.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
function makeTable(key: object, value: unknown): Map<object, unknown> {
  const table = new Map<object, unknown>();
  assert.sameValue(table.set(key, value), table);
  return table;
}
const pairs: [object, object][] = [[{ id: 4 }, { id: 4 }], [[4], [4]], [() => 4, () => 4], [new MapKey(4), new MapKey(4)]];
const values: unknown[] = [undefined, null, -0, NaN, { value: 4 }];
for (const [key, peer] of pairs) for (const value of values) {
  const first: Map<object, unknown> = makeTable(key, value), second: Map<object, unknown> = makeTable(key, peer);
  assert.sameValue(first === second, false);
  assert.sameValue(first.get(key), value); assert.sameValue(second.get(key), peer);
  assert.sameValue(first.has(key), true); assert.sameValue(second.has(key), true);
  assert.sameValue(first.get(peer), undefined); assert.sameValue(second.get(peer), undefined);
  assert.sameValue(first.has(peer), false); assert.sameValue(second.has(peer), false);
  assert.sameValue(first.delete(peer), false); assert.sameValue(second.delete(peer), false);
  assert.sameValue(first.delete(key), true); assert.sameValue(first.delete(key), false);
  assert.sameValue(first.get(key), undefined); assert.sameValue(first.has(key), false);
  assert.sameValue(second.get(key), peer); assert.sameValue(second.has(key), true);
  assert.sameValue(first.set(key, value), first); assert.sameValue(first.get(key), value); assert.sameValue(first.has(key), true);
  assert.sameValue(second.delete(key), true); assert.sameValue(second.delete(key), false);
  assert.sameValue(second.get(key), undefined); assert.sameValue(second.has(key), false);
  assert.sameValue(first.get(key), value); assert.sameValue(first.has(key), true);
}
