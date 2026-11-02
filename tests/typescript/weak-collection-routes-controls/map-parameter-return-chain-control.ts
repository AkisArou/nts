/*---
description: "Control for map-parameter-return-chain: Map set results carried from a typed parameter remain the original collection for subsequent writes."
features: [ts-map-set, ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-tuples, ts-null-undefined, ts-numbers, ts-symbols]
---*/
// A Map parameter hands each set result to the next write; node returns the same collection at every link and deletes by identity.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
function exercise(table: Map<object, unknown>, first: object, second: object, value: unknown): void {
  const one: Map<object, unknown> = table.set(first, value);
  assert.sameValue(one, table);
  const two: Map<object, unknown> = one.set(second, undefined);
  assert.sameValue(two, table);
  assert.sameValue(two.get(first), value); assert.sameValue(two.get(second), undefined);
  assert.sameValue(two.has(first), true); assert.sameValue(two.has(second), true);
  const three: Map<object, unknown> = two.set(first, second);
  assert.sameValue(three, table); assert.sameValue(three.get(first), second);
  assert.sameValue(three.get(second), undefined); assert.sameValue(three.has(second), true);
  assert.sameValue(three.delete(first), true); assert.sameValue(table.delete(first), false);
  assert.sameValue(table.get(first), undefined); assert.sameValue(one.has(first), false);
  assert.sameValue(two.get(second), undefined); assert.sameValue(two.has(second), true);
  assert.sameValue(one.delete(second), true); assert.sameValue(two.delete(second), false);
  assert.sameValue(three.get(second), undefined); assert.sameValue(three.has(second), false);
}
const pairs: [object, object][] = [[{ id: 3 }, { id: 3 }], [[3], [3]], [() => 3, () => 3], [new MapKey(3), new MapKey(3)]];
const values: unknown[] = [undefined, -0, NaN, Symbol('chain'), { value: 3 }];
for (const [first, second] of pairs) for (const value of values) exercise(new Map<object, unknown>(), first, second, value);
