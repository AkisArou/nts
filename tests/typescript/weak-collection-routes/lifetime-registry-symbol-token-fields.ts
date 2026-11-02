/*---
description: Object-or-symbol tokens in interface fields admit local and well-known symbols but reject registered symbols.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unions, ts-typeof-operator, ts-symbols, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration, ts-unknown]
---*/
// FinalizationRegistry tokens cross interface fields and a registry guard; node accepts local and well-known tokens, returns true once, and throws TypeError for registered tokens.
type Key = object | symbol;
interface TokenField { token: Key; accepted: boolean; }
const local = Symbol("same");
const fields: TokenField[] = [{ token: {}, accepted: true }, { token: local, accepted: true }, { token: Symbol("same"), accepted: true }, { token: Symbol.iterator, accepted: true }, { token: Symbol.toStringTag, accepted: true }, { token: Symbol.for(""), accepted: false }, { token: Symbol.for("same"), accepted: false }];
for (const field of fields) {
  const registry: FinalizationRegistry<unknown> = new FinalizationRegistry<unknown>(() => {}), target = {}, token = field.token;
  if (typeof token === "symbol" && Symbol.keyFor(token) !== undefined) {
    assert.sameValue(field.accepted, false);
    assert.throws(TypeError, () => registry.register(target, "held", token));
    assert.throws(TypeError, () => registry.unregister(token));
    assert.sameValue(registry.unregister(target), false);
  } else {
    assert.sameValue(field.accepted, true);
    assert.sameValue(registry.register(target, "held", token), undefined);
    assert.sameValue(registry.unregister(Symbol("same")), false);
    assert.sameValue(registry.unregister(field.token), true);
    assert.sameValue(registry.unregister(token), false);
  }
}
