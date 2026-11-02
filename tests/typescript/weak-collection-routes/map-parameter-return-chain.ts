/*---
description: "WeakMap set results carried from a typed parameter remain the original collection for subsequent writes."
features: [ts-weak-collection-routes, ts-weak-collection-route-map, ts-arrays, ts-iteration, ts-objects, ts-functions, ts-unknown, ts-class, ts-class-fields, ts-tuples, ts-null-undefined, ts-numbers, ts-symbols]
---*/
// A WeakMap parameter hands each set result to the next write; node returns the same collection at every link and deletes by identity.
class MapKey { value: number; constructor(value: number) { this.value = value; } }
function exercise(table: WeakMap<object, unknown>, first: object, second: object, value: unknown): void {
  const one: WeakMap<object, unknown> = table.set(first, value);
  assert.sameValue(one, table);
  const two: WeakMap<object, unknown> = one.set(second, undefined);
  assert.sameValue(two, table);
  assert.sameValue(two.get(first), value); assert.sameValue(two.get(second), undefined);
  assert.sameValue(two.has(first), true); assert.sameValue(two.has(second), true);
  const three: WeakMap<object, unknown> = two.set(first, second);
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
for (const [first, second] of pairs) for (const value of values) exercise(new WeakMap<object, unknown>(), first, second, value);
