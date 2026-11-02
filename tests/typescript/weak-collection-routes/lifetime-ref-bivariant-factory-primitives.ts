/*---
description: A wider factory method interface carries primitive and object targets to the WeakRef constructor.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-tuples, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration]
---*/
// WeakRef construction crosses a wider method interface; node retains admitted targets by identity and throws TypeError for primitives and registered symbols.
type Target = object | symbol;
type Input = Target | string | number | bigint | boolean | null | undefined;
interface RefFactory { make(target: Input): WeakRef<Target>; }
const factory: RefFactory = { make(target: Target): WeakRef<Target> { return new WeakRef(target); } };
const shared = { value: 1 };
const rows: [Input, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.for("same"), false], ["", false], ["text", false], [0, false], [-0, false], [NaN, false], [Infinity, false], [1n, false], [false, false], [true, false], [null, false], [undefined, false]];
for (const [target, accepted] of rows) {
  if ((typeof target === "object" && target !== null) || typeof target === "function" || (typeof target === "symbol" && Symbol.keyFor(target) === undefined)) {
    assert.sameValue(accepted, true);
    const reference = factory.make(target);
    assert.sameValue(reference.deref(), target);
    assert.sameValue(reference.deref(), target);
  } else {
    assert.sameValue(accepted, false);
    assert.throws(TypeError, () => factory.make(target));
  }
}
