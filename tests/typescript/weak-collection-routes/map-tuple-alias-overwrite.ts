/*---
description: "WeakMap keys and their aliases in tuple slots observe overwrites and deletion as one identity."
features: [ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-tuples, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-null-undefined, ts-numbers, ts-symbols]
---*/
// A tuple carries a WeakMap and two aliases beside an equal-content peer; node overwrites one entry and deletes it once through either alias.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
const pairs: [object, object][] = [[{ id: 5 }, { id: 5 }], [[5], [5]], [() => 5, () => 5], [new MapKey(5), new MapKey(5)]];
const values: unknown[] = [-0, NaN, undefined, Symbol('tuple'), { value: 5 }];
for (const [key, peer] of pairs) for (const value of values) {
  const route: [WeakMap<object, unknown>, object, object, object] = [new WeakMap<object, unknown>(), key, key, peer];
  const [table, first, alias, other] = route;
  assert.sameValue(first, alias); assert.sameValue(first === other, false);
  assert.sameValue(table.set(first, value), table); assert.sameValue(table.get(alias), value); assert.sameValue(table.has(alias), true);
  assert.sameValue(table.get(other), undefined); assert.sameValue(table.has(other), false); assert.sameValue(table.delete(other), false);
  assert.sameValue(table.set(alias, other), table); assert.sameValue(table.get(first), other); assert.sameValue(table.get(alias), other);
  assert.sameValue(table.has(first), true); assert.sameValue(table.has(other), false);
  assert.sameValue(table.set(other, value), table); assert.sameValue(table.get(other), value); assert.sameValue(table.has(other), true);
  assert.sameValue(table.delete(alias), true); assert.sameValue(table.delete(first), false);
  assert.sameValue(table.get(first), undefined); assert.sameValue(table.get(alias), undefined);
  assert.sameValue(table.has(first), false); assert.sameValue(table.has(alias), false);
  assert.sameValue(table.get(other), value); assert.sameValue(table.has(other), true);
  assert.sameValue(table.delete(other), true); assert.sameValue(table.delete(other), false);
  assert.sameValue(table.get(other), undefined); assert.sameValue(table.has(other), false);
}
