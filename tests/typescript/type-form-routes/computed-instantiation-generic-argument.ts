/*---
description: "An unknown instantiation expression passed to a generic helper preserves function identity, mixed results and throwing call order."
features: [ts-type-form-routes, ts-type-form-route-computed, ts-instantiation-expression, ts-generics, ts-function-types, ts-objects, ts-numbers, ts-bigint, ts-strings, ts-null-undefined, ts-errors, ts-arrow-functions, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-typeof-operator]
---*/
// echo<unknown> crosses invoke<T> as a callback argument; node preserves the callback object and payload, and RangeError skips the return log.
function same(actual: unknown, expected: unknown): void { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function exact(actual: unknown[], expected: unknown[]): void { assert.compareArray(actual, expected); for (let i = 0; i < actual.length; i++) same(actual[i], expected[i]); }
const log: unknown[] = [];
function echo<T>(value: T, fail: boolean): T {
  log.push("echo", value, fail); if (fail) throw new RangeError("echo"); return value;
}
function invoke<T>(callback: (value: T, fail: boolean) => T, value: T, fail: boolean): T {
  log.push("invoke", callback, value, fail); const result = callback(value, fail); log.push("return", result); return result;
}
function deliver(value: unknown, fail: boolean): unknown { return invoke(echo<unknown>, value, fail); }
const values: unknown[] = [undefined, null, false, -0, NaN, "", 0n, { id: 7 }];
for (const value of values) {
  log.length = 0; same(deliver(value, false), value);
  exact(log, ["invoke", echo, value, false, "echo", value, false, "return", value]);
  log.length = 0; assert.throws(RangeError, () => deliver(value, true));
  exact(log, ["invoke", echo, value, true, "echo", value, true]);
}
