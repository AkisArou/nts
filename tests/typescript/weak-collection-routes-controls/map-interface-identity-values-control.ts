/*---
description: "Control for map-interface-identity-values: Map interface fields preserve object-key identity and every kind of stored value."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-interfaces, ts-unknown, ts-class, ts-class-fields, ts-symbols, ts-bigint, ts-null-undefined, ts-numbers, ts-strings, ts-tuples, ts-functions]
---*/
// Map and its keys cross interface fields; node keeps aliases together, equal-content objects apart, and every stored value exact.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
interface MapRoute { table: Map<object, unknown>; key: object; alias: object; peer: object; }
const pairs: [object, object][] = [[{ id: 1 }, { id: 1 }], [[1], [1]], [() => 1, () => 1], [new MapKey(1), new MapKey(1)]];
const marker = { value: 3 }, other = { value: 3 }, callback = () => 7;
const values: unknown[] = [undefined, null, false, true, 0, -0, NaN, Infinity, -Infinity, 3.5, '', 'value', 0n, 9007199254740993n, Symbol('v'), Symbol.iterator, Symbol.for('weak-value'), marker, other, [1], callback, new MapKey(4)];
for (const [key, peer] of pairs) for (const value of values) {
  const route: MapRoute = { table: new Map<object, unknown>(), key, alias: key, peer };
  assert.sameValue(route.key, route.alias); assert.sameValue(route.key === route.peer, false);
  assert.sameValue(route.table.get(route.key), undefined); assert.sameValue(route.table.has(route.key), false);
  assert.sameValue(route.table.delete(route.peer), false);
  assert.sameValue(route.table.set(route.key, value), route.table);
  assert.sameValue(route.table.get(route.alias), value); assert.sameValue(route.table.has(route.alias), true);
  assert.sameValue(route.table.get(route.peer), undefined); assert.sameValue(route.table.has(route.peer), false);
  assert.sameValue(route.table.set(route.peer, marker), route.table);
  assert.sameValue(route.table.get(route.key), value); assert.sameValue(route.table.get(route.peer), marker);
  assert.sameValue(route.table.has(route.peer), true);
  assert.sameValue(route.table.delete(route.alias), true); assert.sameValue(route.table.delete(route.key), false);
  assert.sameValue(route.table.get(route.key), undefined); assert.sameValue(route.table.has(route.alias), false);
  assert.sameValue(route.table.get(route.peer), marker); assert.sameValue(route.table.has(route.peer), true);
  assert.sameValue(route.table.set(route.key, value), route.table); assert.sameValue(route.table.get(route.alias), value);
  assert.sameValue(route.table.has(route.key), true);
  assert.sameValue(route.table.delete(route.peer), true); assert.sameValue(route.table.delete(route.peer), false);
  assert.sameValue(route.table.get(route.peer), undefined); assert.sameValue(route.table.has(route.peer), false);
}
