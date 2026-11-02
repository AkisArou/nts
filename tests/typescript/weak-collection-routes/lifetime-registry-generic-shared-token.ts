/*---
description: A generic object token removes every registration sharing it, preserves other tokens, and can be registered again.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-tuples, ts-class, ts-class-fields, ts-iteration, ts-unknown]
---*/
// FinalizationRegistry receives an object-constrained token parameter; node unregisters both shared-token registrations once, preserves another token, and permits reuse.
function check<T extends object>(token: T, other: T): void {
  const registry: FinalizationRegistry<unknown> = new FinalizationRegistry<unknown>(() => {});
  const first = { value: 1 }, second = { value: 1 };
  assert.sameValue(registry.register(first, 0, token), undefined);
  assert.sameValue(registry.register(second, "held", token), undefined);
  assert.sameValue(registry.register(first, null, other), undefined);
  assert.sameValue(registry.unregister(token), true);
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(registry.unregister(other), true);
  assert.sameValue(registry.unregister(other), false);
  assert.sameValue(registry.register(second, false, token), undefined);
  assert.sameValue(registry.unregister(token), true);
  assert.sameValue(registry.unregister(token), false);
  assert.sameValue(first === second, false);
}
class Token { value: number; constructor(value: number) { this.value = value; } }
const rows: [object, object][] = [[{ value: 1 }, { value: 1 }], [[1], [1]], [() => 1, () => 1], [new Token(1), new Token(1)]];
for (const [token, other] of rows) check(token, other);
