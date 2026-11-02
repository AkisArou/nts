/*---
description: Control for lifetime-ref-narrowed-symbol-targets using plain holders and explicit registered-symbol refusal.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-unions, ts-typeof-operator, ts-symbols, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-errors, ts-iteration]
---*/
// A plain target holder receives the same narrowed union; an explicit registry check throws TypeError and accepted targets read back by identity.
type Target = object | symbol;
function hold(target: Target): { target: Target } {
  if (typeof target === "symbol" && Symbol.keyFor(target) !== undefined) throw new TypeError();
  return { target };
}
const shared = { value: 1 }, local = Symbol("same");
const rows: [Target, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [local, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.toStringTag, true], [Symbol.for(""), false], [Symbol.for("same"), false]];
for (const [target, accepted] of rows) {
  if (typeof target === "symbol" && Symbol.keyFor(target) !== undefined) {
    assert.sameValue(accepted, false);
    assert.throws(TypeError, () => hold(target));
  } else {
    assert.sameValue(accepted, true);
    const reference: { target: Target } = hold(target);
    assert.sameValue(reference.target, target);
    assert.sameValue(reference.target, target);
  }
}
