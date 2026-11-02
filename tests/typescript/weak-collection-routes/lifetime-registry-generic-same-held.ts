/*---
description: Generic object aliases used as both target and held value throw without registering the supplied token.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-errors]
---*/
// FinalizationRegistry receives a generic object as target and held alias; node throws TypeError without registration, then accepts distinct held data.
function check<T extends object>(target: T): void {
  const registry: FinalizationRegistry<unknown> = new FinalizationRegistry<unknown>(() => {});
  const alias = target, token = { value: 1 }, held = { value: 1 };
  assert.throws(TypeError, () => registry.register(target, alias, token));
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(registry.register(target, held, token), undefined);
  assert.sameValue(registry.unregister(token), true);
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(alias, target);
}
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const targets: object[] = [shared, shared, { value: 1 }, [1], () => 1, new Item(1)];
for (const target of targets) check(target);
