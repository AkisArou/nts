/*---
description: A narrowed target union distinguishes rejected registry targets from registrations with omitted and explicit undefined tokens.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-unions, ts-typeof-operator, ts-symbols, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration, ts-unknown, ts-null-undefined]
---*/
// FinalizationRegistry receives narrowed object-or-symbol targets; node rejects registered symbols and leaves omitted or undefined tokens unregistered, until an explicit target token is supplied.
type Target = object | symbol;
const shared = { value: 1 };
const rows: [Target, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.for("same"), false], [Symbol.for(""), false]];
for (const [target, accepted] of rows) {
  const registry: FinalizationRegistry<unknown> = new FinalizationRegistry<unknown>(() => {});
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
