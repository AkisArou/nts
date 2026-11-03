/*---
description: "An instantiated function value crosses a declared return and retains identity and live call state on later calls."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-instantiation-expression, ts-generics, ts-typeof-type, ts-numbers, ts-strings, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// echo<number> crosses choose and a stored returned value; node keeps repeated returns identical to echo and observes each later version and exact numeric payload.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = []; let version = 0;
function echo<T>(value: T): T { log.push("echo", version, value); return value; }
function choose(): typeof echo<number> { return echo<number>; }
const retained = choose();
for (const value of [-0, NaN, 2.5]) {
  version++; log.length = 0; const again = choose();
  same(retained, echo); same(again, retained); same(typeof retained, "function");
  same(retained(value), value); same(again(value), value);
  exact(log, ["echo", version, value, "echo", version, value]);
}
