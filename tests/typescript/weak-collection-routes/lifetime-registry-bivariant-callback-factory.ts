/*---
description: A wider registry factory method admits callable callbacks and exposes constructor TypeErrors for noncallable values.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-function-types, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration, ts-unknown]
---*/
// FinalizationRegistry construction crosses a wider callback method interface; node accepts functions, throws TypeError for noncallables, and unregisters supplied tokens exactly.
type Input = object | symbol | string | number | bigint | boolean | null | undefined;
interface RegistryFactory { make(callback: Input): FinalizationRegistry<unknown>; }
const factory: RegistryFactory = { make(callback: (held: unknown) => void): FinalizationRegistry<unknown> { return new FinalizationRegistry<unknown>(callback); } };
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
