/*---
description: Control for lifetime-registry-narrowed-optional-token using explicit target checks and a Set that records only supplied tokens.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-unions, ts-typeof-operator, ts-symbols, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration, ts-unknown, ts-null-undefined, ts-map-set, ts-class, ts-class-fields]
---*/
// A Set model receives the same target union; explicit checks reject registered symbols, and only an explicitly supplied target token gains membership.
type Target = object | symbol;
function requireKey(key: Target): void { if (typeof key === "symbol" && Symbol.keyFor(key) !== undefined) throw new TypeError(); }
class TokenRegistry {
  tokens: Set<Target> = new Set<Target>();
  register(target: Target, held: unknown, token?: Target): void {
    requireKey(target); if (target === held) throw new TypeError();
    if (token !== undefined) { requireKey(token); assert.sameValue(this.tokens.add(token), this.tokens); }
  }
  unregister(token: Target): boolean { requireKey(token); return this.tokens.delete(token); }
}
const shared = { value: 1 };
const rows: [Target, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.for("same"), false], [Symbol.for(""), false]];
for (const [target, accepted] of rows) {
  const registry: TokenRegistry = new TokenRegistry();
  if (typeof target === "symbol" && Symbol.keyFor(target) !== undefined) {
    assert.sameValue(accepted, false);
    assert.throws(TypeError, () => registry.register(target, "held"));
  } else {
    assert.sameValue(accepted, true);
    assert.sameValue(registry.register(target, "held"), undefined);
    assert.sameValue(registry.register(target, null, undefined), undefined);
    assert.sameValue(registry.unregister(target), false);
    assert.sameValue(registry.register(target, 0, target), undefined);
    assert.sameValue(registry.unregister(target), true);
    assert.sameValue(registry.unregister(target), false);
  }
}
