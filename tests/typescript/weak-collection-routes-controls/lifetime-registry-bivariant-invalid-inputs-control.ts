/*---
description: Control for lifetime-registry-bivariant-invalid-inputs using explicit eligibility checks and a Set-backed token model.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration, ts-unknown, ts-map-set, ts-class, ts-class-fields]
---*/
// A Set-backed model crosses the same wider methods; explicit eligibility checks reproduce target/token TypeErrors while undefined registration tokens stay absent.
type Input = object | symbol | string | number | bigint | boolean | null | undefined;
type Key = object | symbol;
function requireKey(key: Input): void { if (!((typeof key === "object" && key !== null) || typeof key === "function" || (typeof key === "symbol" && Symbol.keyFor(key) === undefined))) throw new TypeError(); }
class TokenRegistry {
  tokens: Set<Key> = new Set<Key>();
  register(target: Key, held: unknown, token?: Key): void {
    requireKey(target); if (target === held) throw new TypeError();
    if (token !== undefined) { requireKey(token); assert.sameValue(this.tokens.add(token), this.tokens); }
  }
  unregister(token: Key): boolean { requireKey(token); return this.tokens.delete(token); }
}
interface Registry { register(target: Input, held: unknown, token?: Input): void; unregister(token: Input): boolean; }
const shared = { value: 1 };
const inputs: Input[] = [shared, { value: 1 }, shared, [1], () => 1, Symbol("same"), Symbol.iterator, Symbol.for("same"), "", "text", 0, -0, NaN, 1n, false, true, null, undefined];
for (const input of inputs) {
  const registry: Registry = new TokenRegistry(), target = {}, token = {};
  if ((typeof input === "object" && input !== null) || typeof input === "function" || (typeof input === "symbol" && Symbol.keyFor(input) === undefined)) {
    assert.sameValue(registry.register(input, "held", token), undefined);
    assert.sameValue(registry.unregister(token), true);
    assert.sameValue(registry.unregister(token), false);
    assert.sameValue(registry.register(target, "held", input), undefined);
    assert.sameValue(registry.unregister(input), true);
    assert.sameValue(registry.unregister(input), false);
  } else {
    assert.throws(TypeError, () => registry.register(input, "held", token));
    assert.sameValue(registry.unregister(token), false);
    if (input === undefined) {
      assert.sameValue(registry.register(target, "held", input), undefined);
      assert.sameValue(registry.unregister(target), false);
    } else assert.throws(TypeError, () => registry.register(target, "held", input));
    assert.throws(TypeError, () => registry.unregister(input));
  }
}
