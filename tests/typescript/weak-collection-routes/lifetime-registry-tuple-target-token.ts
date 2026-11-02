/*---
description: A tuple target may also be its unregister token while its held value is a distinct value of any kind.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-null-undefined, ts-bigint, ts-symbols]
---*/
// FinalizationRegistry takes targets and held values from tuples; node accepts the target itself as token, returns undefined, then unregisters true and false.
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const rows: [object, unknown][] = [[shared, undefined], [{ value: 1 }, null], [shared, false], [[1], -0], [() => 1, 1n], [new Item(1), Symbol.for("held")], [{ value: 1 }, { value: 1 }], [[1], () => 2]];
function check(row: [object, unknown]): void {
  const [target, held] = row, registry: FinalizationRegistry<unknown> = new FinalizationRegistry<unknown>(() => {});
  assert.sameValue(registry.register(target, held, target), undefined);
  assert.sameValue(registry.unregister(target), true);
  assert.sameValue(registry.unregister(target), false);
  assert.sameValue(row[0], target);
  assert.sameValue(row[1], held);
}
for (const row of rows) check(row);
