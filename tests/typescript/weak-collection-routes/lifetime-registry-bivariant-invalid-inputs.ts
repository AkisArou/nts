/*---
description: A wider registry method interface checks primitive target and token refusals, including unregister of undefined.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration, ts-unknown]
---*/
// FinalizationRegistry crosses a wider method interface; node rejects primitive targets and tokens, permits an undefined registration token, and throws on unregister(undefined).
type Input = object | symbol | string | number | bigint | boolean | null | undefined;
interface Registry { register(target: Input, held: unknown, token?: Input): void; unregister(token: Input): boolean; }
const shared = { value: 1 };
const inputs: Input[] = [shared, { value: 1 }, shared, [1], () => 1, Symbol("same"), Symbol.iterator, Symbol.for("same"), "", "text", 0, -0, NaN, 1n, false, true, null, undefined];
for (const input of inputs) {
  const registry: Registry = new FinalizationRegistry<unknown>(() => {}), target = {}, token = {};
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
