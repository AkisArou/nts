/*---
description: Control for lifetime-ref-bivariant-factory-primitives using plain holders and an explicit weak-target eligibility check.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-interfaces, ts-unsound-bivariance, ts-unions, ts-typeof-operator, ts-objects, ts-arrays, ts-functions, ts-tuples, ts-symbols, ts-bigint, ts-null-undefined, ts-errors, ts-iteration]
---*/
// Plain-holder construction crosses the same wider method interface; an explicit eligibility check gives TypeError for the same refused inputs.
type Target = object | symbol;
type Input = Target | string | number | bigint | boolean | null | undefined;
interface RefFactory { make(target: Input): { target: Target }; }
const factory: RefFactory = { make(target: Target): { target: Target } {
  if (!((typeof target === "object" && target !== null) || typeof target === "function" || (typeof target === "symbol" && Symbol.keyFor(target) === undefined))) throw new TypeError();
  return { target };
} };
const shared = { value: 1 };
const rows: [Input, boolean][] = [[shared, true], [{ value: 1 }, true], [shared, true], [[1], true], [() => 1, true], [Symbol("same"), true], [Symbol.iterator, true], [Symbol.for("same"), false], ["", false], ["text", false], [0, false], [-0, false], [NaN, false], [Infinity, false], [1n, false], [false, false], [true, false], [null, false], [undefined, false]];
for (const [target, accepted] of rows) {
  if ((typeof target === "object" && target !== null) || typeof target === "function" || (typeof target === "symbol" && Symbol.keyFor(target) === undefined)) {
    assert.sameValue(accepted, true);
    const reference = factory.make(target);
    assert.sameValue(reference.target, target);
    assert.sameValue(reference.target, target);
  } else {
    assert.sameValue(accepted, false);
    assert.throws(TypeError, () => factory.make(target));
  }
}
