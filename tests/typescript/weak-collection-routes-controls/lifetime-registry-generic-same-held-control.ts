/*---
description: Control for lifetime-registry-generic-same-held using a Set token model and an explicit target-held identity check.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-errors, ts-map-set]
---*/
// A Set-backed registry model receives the same generic target and held alias; explicit identity rejection throws TypeError before adding the token.
class TokenRegistry {
  tokens: Set<object> = new Set<object>();
  register(target: object, held: unknown, token?: object): void {
    if (target === held) throw new TypeError();
    if (token !== undefined) assert.sameValue(this.tokens.add(token), this.tokens);
  }
  unregister(token: object): boolean { return this.tokens.delete(token); }
}
function check<T extends object>(target: T): void {
  const registry: TokenRegistry = new TokenRegistry();
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
