/*---
description: Control for lifetime-registry-bivariant-callback-factory using an explicit callable check and a Set-backed token model.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-function-types, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration, ts-unknown, ts-map-set, ts-class, ts-class-fields]
---*/
// A Set-backed registry factory crosses the same wider callback interface; an explicit callable check throws TypeError for the same values without invoking callbacks.
type Input = object | symbol | string | number | bigint | boolean | null | undefined;
class TokenRegistry {
  tokens: Set<object> = new Set<object>();
  register(target: object, held: unknown, token?: object): void {
    if (target === held) throw new TypeError();
    if (token !== undefined) assert.sameValue(this.tokens.add(token), this.tokens);
  }
  unregister(token: object): boolean { return this.tokens.delete(token); }
}
interface RegistryFactory { make(callback: Input): TokenRegistry; }
const factory: RegistryFactory = { make(callback: (held: unknown) => void): TokenRegistry {
  if (typeof callback !== "function") throw new TypeError();
  return new TokenRegistry();
} };
const first = (_held: unknown): void => {}, second = function (_held: unknown): void {};
const callbacks: Input[] = [first, second, first, {}, [], Symbol("callback"), Symbol.for("callback"), "", "callback", 0, NaN, 1n, false, true, null, undefined];
for (const callback of callbacks) {
  if (typeof callback === "function") {
    const registry = factory.make(callback), target = {}, token = {};
    assert.sameValue(registry.register(target, "held", token), undefined);
    assert.sameValue(registry.unregister(token), true);
    assert.sameValue(registry.unregister(token), false);
  } else {
    assert.throws(TypeError, () => factory.make(callback));
  }
}
