/*---
description: "Control for map-union-narrowed: A discriminant-narrowed union exposes the selected Map without confusing equal-content keys."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-unions, ts-discriminated-unions, ts-literal-types, ts-narrowing, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-tuples, ts-null-undefined, ts-numbers]
---*/
// A collection union narrows by its tag before Map operations; node chooses the live route, preserves identity and returns the exact stored value.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
type MapRoute = { kind: 'live'; table: Map<object, unknown>; key: object; peer: object } | { kind: 'empty' };
function exercise(route: MapRoute, value: unknown): boolean {
  if (route.kind === 'empty') return false;
  const table = route.table;
  assert.sameValue(table.get(route.key), undefined); assert.sameValue(table.has(route.key), false);
  assert.sameValue(table.set(route.key, value), table); assert.sameValue(table.get(route.key), value); assert.sameValue(table.has(route.key), true);
  assert.sameValue(table.get(route.peer), undefined); assert.sameValue(table.has(route.peer), false); assert.sameValue(table.delete(route.peer), false);
  assert.sameValue(table.set(route.peer, route.key), table); assert.sameValue(table.get(route.peer), route.key); assert.sameValue(table.has(route.peer), true);
  assert.sameValue(table.delete(route.key), true); assert.sameValue(table.delete(route.key), false);
  assert.sameValue(table.get(route.key), undefined); assert.sameValue(table.has(route.key), false);
  assert.sameValue(table.get(route.peer), route.key); assert.sameValue(table.has(route.peer), true);
  assert.sameValue(table.delete(route.peer), true); assert.sameValue(table.delete(route.peer), false);
  assert.sameValue(table.get(route.peer), undefined); assert.sameValue(table.has(route.peer), false);
  return true;
}
const pairs: [object, object][] = [[{ id: 6 }, { id: 6 }], [[6], [6]], [() => 6, () => 6], [new MapKey(6), new MapKey(6)]];
const values: unknown[] = [undefined, -0, NaN, { value: 6 }];
for (const [key, peer] of pairs) for (const value of values) {
  const routes: MapRoute[] = [{ kind: 'empty' }, { kind: 'live', table: new Map<object, unknown>(), key, peer }];
  const answers: boolean[] = [];
  for (const route of routes) answers.push(exercise(route, value));
  assert.compareArray(answers, [false, true]);
}
