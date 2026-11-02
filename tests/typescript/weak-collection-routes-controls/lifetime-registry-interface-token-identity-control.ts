/*---
description: Control for lifetime-registry-interface-token-identity using a Set-backed token model in the same interface fields.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-objects, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-iteration, ts-unknown, ts-map-set, ts-errors]
---*/
// A Set-backed registry model crosses the same interface fields; node returns false for substitutes and true then false for the registered token alias.
class TokenRegistry {
  tokens: Set<object> = new Set<object>();
  register(target: object, held: unknown, token?: object): void {
    if (target === held) throw new TypeError();
    if (token !== undefined) assert.sameValue(this.tokens.add(token), this.tokens);
  }
  unregister(token: object): boolean { return this.tokens.delete(token); }
}
interface Registration { registry: TokenRegistry; token: object; }
class Token { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const tokens: object[] = [shared, shared, { value: 1 }, [1], () => 1, new Token(1)];
for (const token of tokens) {
  const view: Registration = { registry: new TokenRegistry(), token };
  const target = { live: token }, alias = view.token, substitute = { value: 1 };
  assert.sameValue(view.registry.unregister(view.token), false);
  assert.sameValue(view.registry.register(target, "held", view.token), undefined);
  assert.sameValue(view.registry.unregister(substitute), false);
  assert.sameValue(view.registry.unregister(alias), true);
  assert.sameValue(view.registry.unregister(view.token), false);
  assert.sameValue(target.live, token);
}
