/*---
description: Void callback array elements preserve returned primitive and reference values when called in reverse order.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-void, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-numbers, ts-strings, ts-bigint, ts-symbols, ts-objects, ts-null-undefined, ts-unknown, ts-typeof-operator]
---*/
// A void signature crosses typed callback array elements into unknown; node keeps every captured value and calls each element in reverse order.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
const reference = { id: 7 }, callable = () => 9, token = Symbol("returned");
const values: unknown[] = [undefined, null, false, true, -0, NaN, 0n, 7n, "", "kept", token, reference, callable];
const callbacks: (() => void)[] = [], log: number[] = [];
for (let index = 0; index < values.length; index++) {
  const value = values[index];
  callbacks.push(() => { log.push(index); return value; });
}
for (let index = callbacks.length - 1; index >= 0; index--) {
  const callback = callbacks[index];
  same(typeof callback, "function");
  const value: unknown = callback();
  same(value, values[index]);
}
assert.compareArray(log, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
