/*---
description: "Control for values-alias-tuple-snapshot; A namespace primitive alias in a tuple preserves captured negative zero beside a live reader."
features: [ts-type-form-routes, ts-type-form-route-values, ts-namespace, ts-tuples, ts-function-types, ts-arrow-functions, ts-numbers, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// import saved = State.current crosses a typed tuple beside a live callback; node keeps the captured -0 while the namespace becomes 2.5, NaN and either zero. The control uses a const initialized from the same namespace number.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
namespace State { export let current: number = -0; }
const saved = State.current;
const route: [number, () => number] = [saved, () => State.current];
for (const value of [2.5, NaN, 0, -0]) {
  State.current = value;
  same(route[0], -0); same(saved, -0); same(route[1](), value); same(State.current, value);
  same(typeof route[1], "function");
}
