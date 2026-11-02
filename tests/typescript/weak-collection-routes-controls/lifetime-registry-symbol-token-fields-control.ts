/*---
description: Control for lifetime-registry-symbol-token-fields using a Set model with explicit registered-symbol checks.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unions, ts-typeof-operator, ts-symbols, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration, ts-unknown, ts-map-set, ts-class, ts-class-fields]
---*/
// A Set-backed model uses the same token fields and guard; explicit checks refuse registered symbols while accepted tokens unregister true then false.
type Key = object | symbol;
function requireKey(key: Key): void { if (typeof key === "symbol" && Symbol.keyFor(key) !== undefined) throw new TypeError(); }
class TokenRegistry {
  tokens: Set<Key> = new Set<Key>();
  register(target: Key, held: unknown, token?: Key): void {
    requireKey(target); if (target === held) throw new TypeError();
    if (token !== undefined) { requireKey(token); assert.sameValue(this.tokens.add(token), this.tokens); }
  }
  unregister(token: Key): boolean { requireKey(token); return this.tokens.delete(token); }
}
interface TokenField { token: Key; accepted: boolean; }
const local = Symbol("same");
const fields: TokenField[] = [{ token: {}, accepted: true }, { token: local, accepted: true }, { token: Symbol("same"), accepted: true }, { token: Symbol.iterator, accepted: true }, { token: Symbol.toStringTag, accepted: true }, { token: Symbol.for(""), accepted: false }, { token: Symbol.for("same"), accepted: false }];
for (const field of fields) {
  const registry: TokenRegistry = new TokenRegistry(), target = {}, token = field.token;
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
