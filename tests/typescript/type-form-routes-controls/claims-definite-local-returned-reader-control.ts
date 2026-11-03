/*---
description: Unassigned definite locals remain undefined before and after a generic reader escapes their scope. The control uses honest types.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-generics, ts-functions, ts-function-types, ts-closures, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-bigint, ts-objects, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-errors, ts-unions]
---*/
// A definite local claim crosses a returned generic reader; node reads undefined immediately and on each later call without manufacturing a default value. The control states the possible value honestly.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
function makeReader<T>(): () => T | undefined {
  let pending: T | undefined;
  same(pending, undefined);
  return () => pending;
}
function inspect<T>(reader: () => T) {
  for (const turn of [0, 1]) {
    const value = reader();
    same(value, undefined);
    assert.throws(TypeError, () => Object.prototype.valueOf.call(value));
  }
}
inspect(makeReader<number>());
inspect(makeReader<string>());
inspect(makeReader<boolean>());
inspect(makeReader<bigint>());
inspect(makeReader<{ id: number }>());
inspect(makeReader<() => number>());
