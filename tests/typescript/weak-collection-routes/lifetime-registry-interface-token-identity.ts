/*---
description: A registry and object token in interface fields preserve token aliases and reject equal-content substitutes.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-objects, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-iteration, ts-unknown]
---*/
// FinalizationRegistry and tokens cross interface fields; node registers with undefined, unregisters the same token once, and refuses equal-content substitutes with false.
interface Registration { registry: FinalizationRegistry<unknown>; token: object; }
class Token { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const tokens: object[] = [shared, shared, { value: 1 }, [1], () => 1, new Token(1)];
for (const token of tokens) {
  const view: Registration = { registry: new FinalizationRegistry<unknown>(() => {}), token };
  const target = { live: token }, alias = view.token, substitute = { value: 1 };
  assert.sameValue(view.registry.unregister(view.token), false);
  assert.sameValue(view.registry.register(target, "held", view.token), undefined);
  assert.sameValue(view.registry.unregister(substitute), false);
  assert.sameValue(view.registry.unregister(alias), true);
  assert.sameValue(view.registry.unregister(view.token), false);
  assert.sameValue(target.live, token);
}
