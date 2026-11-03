/*---
description: Unassigned definite fields keep undefined through generic class reads at primitive and reference instantiations.
features: [ts-type-form-routes, ts-type-form-route-claims, ts-definite-assignment, ts-class, ts-class-fields, ts-generics, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-numbers, ts-strings, ts-bigint, ts-objects, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-errors]
---*/
// A definite field claim crosses a generic class return; node returns undefined at every instantiation and leaves an own field present.
function same(actual: unknown, expected: unknown) { assert.sameValue(actual, expected); assert.sameValue(typeof actual, typeof expected); }
class Pending<T> {
  value!: T;
  read(): T { return this.value; }
}
function inspect<T>(slot: Pending<T>) {
  for (const turn of [0, 1]) {
    const value = slot.read();
    same(value, undefined);
    same(Object.hasOwn(slot, "value"), true);
    assert.throws(TypeError, () => Object.prototype.valueOf.call(value));
  }
}
inspect(new Pending<number>());
inspect(new Pending<string>());
inspect(new Pending<boolean>());
inspect(new Pending<bigint>());
inspect(new Pending<{ id: number }>());
inspect(new Pending<() => number>());
