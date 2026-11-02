/*---
description: A narrowed object-or-symbol route admits ordinary and well-known WeakRef targets and rejects registered symbols.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-unions, ts-typeof-operator, ts-symbols, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration]
---*/
// WeakRef receives an object-or-symbol union narrowed by registry lookup; node returns each admitted target by identity and throws TypeError for registered symbols.
type Target = object | symbol;
const shared = { value: 1 }, local = Symbol("same");
const rows: [Target, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [local, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.toStringTag, true], [Symbol.for(""), false], [Symbol.for("same"), false]];
for (const [target, accepted] of rows) {
  if (typeof target === "symbol" && Symbol.keyFor(target) !== undefined) {
    assert.sameValue(accepted, false);
    assert.throws(TypeError, () => new WeakRef(target));
  } else {
    assert.sameValue(accepted, true);
    const reference: WeakRef<Target> = new WeakRef(target);
    assert.sameValue(reference.deref(), target);
    assert.sameValue(reference.deref(), target);
  }
}
